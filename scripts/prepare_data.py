from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import box, mapping

ABSOLUTE_FIELDS = [
    "tot_p",
    "tot_m",
    "tot_f",
    "p_00_14",
    "m_00_14",
    "f_00_14",
    "p_15_64",
    "m_15_64",
    "f_15_64",
    "p_65_",
    "m_65_",
    "f_65_",
    "p_00_04",
    "p_05_09",
    "p_10_14",
    "p_15_19",
    "p_20_24",
    "p_25_29",
    "p_30_34",
    "p_35_39",
    "p_40_44",
    "p_45_49",
    "p_50_54",
    "p_55_59",
    "p_60_64",
    "p_65_69",
    "p_70_74",
    "p_75_79",
    "p_80_84",
    "p_85_",
    "edct_1",
    "edct_2",
    "edct_3",
]

WEIGHTED_MEAN_FIELDS = ["age_p", "age_m", "age_f"]
OUTPUT_FIELDS = ABSOLUTE_FIELDS + WEIGHTED_MEAN_FIELDS


def normalize_value(value):
    if pd.isna(value):
        return None
    if isinstance(value, str):
        value = value.strip().replace(",", ".")
        if not value:
            return None
        if value in {".", "..", "...", "....", ".....", "-", "NA", "N/A"}:
            return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric <= -1000000:
        return None
    if numeric.is_integer():
        return int(numeric)
    return round(numeric, 4)


def detect_year(path: Path) -> str:
    folder_year = path.parent.name
    if folder_year.isdigit():
        return folder_year
    match = re.search(r"(20\d{2})", path.stem)
    if match:
        return match.group(1)
    raise ValueError(f"Ne morem razbrati leta iz poti: {path}")


def discover_shapefiles(input_root: Path) -> list[Path]:
    return sorted(input_root.glob("*/*.shp"))


def read_grid(path: Path) -> gpd.GeoDataFrame:
    return gpd.read_file(path, engine="fiona")


def write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def build_cell_frame(cell_ids: list[str]) -> tuple[pd.DataFrame, list[float], list[float]]:
    cell_frame = pd.DataFrame({"cell_id": pd.Series(cell_ids, dtype="string")})
    cell_frame["x"] = cell_frame["cell_id"].str.extract(r"SIHM100_(\d+)_")[0].astype(int).mul(100)
    cell_frame["y"] = cell_frame["cell_id"].str.extract(r"SIHM100_\d+_(\d+)")[0].astype(int).mul(100)
    cell_frame = cell_frame.sort_values(["y", "x", "cell_id"]).reset_index(drop=True)

    bounds_projected = [
        float(cell_frame["x"].min()),
        float(cell_frame["y"].min()),
        float(cell_frame["x"].max() + 100),
        float(cell_frame["y"].max() + 100),
    ]
    bbox_series = gpd.GeoSeries([box(*bounds_projected)], crs="EPSG:3794").to_crs("EPSG:4326")
    bounds_wgs84 = bbox_series.total_bounds.tolist()
    return cell_frame, bounds_projected, bounds_wgs84


def convert_admin(admin_path: Path, output_root: Path, cell_frame: pd.DataFrame):
    admin_gdf = gpd.read_file(admin_path, engine="fiona").to_crs("EPSG:3794")
    points = gpd.GeoDataFrame(
        cell_frame[["cell_id"]].copy(),
        geometry=gpd.points_from_xy(cell_frame["x"] + 50, cell_frame["y"] + 50),
        crs="EPSG:3794",
    )
    join = gpd.sjoin(points, admin_gdf, how="left", predicate="within")

    admin_id_column = next(
        (name for name in ["admin_id", "ID", "sifra", "code", "MUN_ID", "OB_UIME"] if name in admin_gdf.columns),
        admin_gdf.columns[0],
    )
    admin_name_column = next(
        (name for name in ["admin_name", "NAME", "ime", "name", "OB_UIME"] if name in admin_gdf.columns),
        admin_id_column,
    )

    mapping_payload: dict[str, list[str]] = {}
    for admin_id, group in join.groupby(admin_id_column):
        if pd.isna(admin_id):
            continue
        mapping_payload[str(admin_id)] = sorted(group["cell_id"].dropna().astype(str).unique().tolist())

    admin_view = admin_gdf.to_crs("EPSG:4326").copy()
    admin_view["admin_id"] = admin_view[admin_id_column].astype(str)
    admin_view["admin_name"] = admin_view[admin_name_column].astype(str)
    geojson_payload = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"admin_id": row["admin_id"], "admin_name": row["admin_name"]},
                "geometry": mapping(row.geometry),
            }
            for _, row in admin_view.iterrows()
        ],
    }

    write_json(output_root / "admin" / "municipalities.geojson", geojson_payload)
    write_json(output_root / "admin" / "municipality-cells.json", mapping_payload)


def main():
    parser = argparse.ArgumentParser(description="Pretvori SURS demografski grid v statične JSON datoteke za frontend.")
    parser.add_argument("--input-root", default="podatki", help="Koren vhodnih map po letih.")
    parser.add_argument("--output-root", default="public", help="Koren izhodnih statičnih datotek.")
    parser.add_argument("--admin-shp", default=None, help="Opcijska pot do sloja administrativnih enot.")
    args = parser.parse_args()

    input_root = Path(args.input_root)
    output_root = Path(args.output_root)
    shapefiles = discover_shapefiles(input_root)
    if not shapefiles:
        raise SystemExit(f"V {input_root} ni najdenih shapefile datotek.")

    years: list[str] = []
    union_cell_ids: set[str] = set()

    for shapefile_path in shapefiles:
        year = detect_year(shapefile_path)
        years.append(year)
        gdf = read_grid(shapefile_path)

        if "ime_celice" not in gdf.columns:
            raise ValueError(f"{shapefile_path} nima stolpca 'ime_celice'.")

        union_cell_ids.update(gdf["ime_celice"].astype(str).tolist())

    cell_frame, bounds_projected, bounds_wgs84 = build_cell_frame(sorted(union_cell_ids))
    grid_payload = {
        "cell_ids": cell_frame["cell_id"].tolist(),
        "x_coords": cell_frame["x"].tolist(),
        "y_coords": cell_frame["y"].tolist(),
        "bbox_projected": bounds_projected,
        "bbox_wgs84": bounds_wgs84,
        "cell_size_m": 100,
    }
    write_json(output_root / "data" / "grid-index.json", grid_payload)

    for shapefile_path in shapefiles:
        year = detect_year(shapefile_path)
        gdf = read_grid(shapefile_path)
        frame = gdf[["ime_celice", *[field for field in OUTPUT_FIELDS if field in gdf.columns]]].copy().rename(columns={"ime_celice": "cell_id"})
        frame["cell_id"] = frame["cell_id"].astype(str)
        for field in OUTPUT_FIELDS:
            if field not in frame.columns:
                frame[field] = None
        merged = cell_frame[["cell_id"]].merge(frame, on="cell_id", how="left")

        columns = {field: [normalize_value(value) for value in merged[field].tolist()] for field in OUTPUT_FIELDS}
        year_payload = {"year": year, "fields": OUTPUT_FIELDS, "columns": columns}
        write_json(output_root / "data" / "attributes" / f"{year}.json", year_payload)
        print(f"Pripravljeno leto {year}: {len(merged)} celic")

    manifest_payload = {
        "years": sorted(set(years)),
        "cell_count": len(cell_frame),
        "fields": OUTPUT_FIELDS,
        "description": "Geometrija je implicitna regularna mreža 100 x 100 m, atributi pa so ločeni po letih.",
    }
    write_json(output_root / "data" / "manifest.json", manifest_payload)

    if args.admin_shp:
        convert_admin(Path(args.admin_shp), output_root, cell_frame)
        print("Pripravljen je tudi administrativni sloj.")


if __name__ == "__main__":
    main()
