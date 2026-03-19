# Demografska analiza 100 x 100 m za Slovenijo

Ta repozitorij vsebuje preprost statični prototip za prikaz in osnovno analizo demografskih podatkov po gridu `100 x 100 m` za Slovenijo. Projekt je zasnovan za GitHub Pages, zato nima backend-a, baze ali server-side API-ja.

## Arhitektura

Najpreprostejši delujoči model za GitHub Pages je:

- geometrije celic ne hranimo kot velik GeoJSON z desettisoči poligoni
- frontend iz `cell_id` sam rekonstruira kvadratno geometrijo `100 x 100 m`
- v `public/data/grid-index.json` je seznam obstoječih celic in bbox
- atributi so ločeni po letih v `public/data/attributes/<leto>.json`
- vse agregacije tečejo neposredno v brskalniku

Ta pristop je bistveno lažji za objavo kot poln grid GeoJSON sloj in ostane povsem statičen.

## Struktura projekta

- `src/` React aplikacija
- `public/data/` statični podatki za frontend
- `public/admin/` opcijski administrativni sloji
- `scripts/prepare_data.py` pretvorba shapefile vhodov v JSON
- `.github/workflows/deploy.yml` GitHub Pages deploy

## Funkcionalnosti

- klik na eno celico
- izbor več celic z več kliki v načinu dodajanja
- risanje poligona na karti
- opcijski izbor administrativne enote, če pripraviš občinski sloj
- agregacija izbranih celic v brskalniku
- časovna vrsta za eno ali več let
- graf starostne strukture
- graf velikih starostnih skupin
- prikaz dodatnih kazalnikov
- graf izobrazbene strukture

## Podatkovni model

### `public/data/grid-index.json`

Vsebuje:

- `cell_ids`
- `x_coords`
- `y_coords`
- `bbox_projected`
- `bbox_wgs84`
- `cell_size_m`

### `public/data/attributes/<leto>.json`

Vsebuje:

- `year`
- `fields`
- `columns`

`columns` je stolpčni zapis. Vrednosti so v enakem vrstnem redu kot `cell_ids` v `grid-index.json`.

## Priprava vhodnih podatkov

Vhod pričakuje mapo oblike:

```text
podatki/
  2024/
    v213_2024_01_01.shp
    v213_2024_01_01.dbf
    v213_2024_01_01.shx
    v213_2024_01_01.prj
```

Če imaš več let, dodaj dodatne podmape:

```text
podatki/
  2019/
    *.shp
  2020/
    *.shp
  2021/
    *.shp
```

## Kako pripraviti podatke

Potrebno je Python okolje z nameščenimi knjižnicami:

- `geopandas`
- `fiona`
- `shapely`
- `pandas`

Zagon:

```bash
python scripts/prepare_data.py --input-root podatki --output-root public
```

Če imaš tudi sloj občin ali drugih administrativnih enot:

```bash
python scripts/prepare_data.py --input-root podatki --output-root public --admin-shp path/to/municipalities.shp
```

Skripta:

- prebere shapefile po letih
- uporabi `ime_celice` kot `cell_id`
- pripravi `grid-index.json`
- pripravi `attributes/<leto>.json`
- opcijsko pripravi `public/admin/municipalities.geojson`
- opcijsko pripravi `public/admin/municipality-cells.json`

## Lokalni zagon

### 1. Namesti Node.js

Priporočen je Node `20+`.

### 2. Namesti odvisnosti

```bash
npm install
```

### 3. Zaženi razvojni strežnik

```bash
npm run dev
```

### 4. Naredi produkcijski build

```bash
npm run build
```

## Deploy na GitHub Pages

Workflow v `.github/workflows/deploy.yml`:

- ob push-u na `main` zažene `npm ci`
- naredi `vite build`
- objavi `dist/` na GitHub Pages

V GitHub repozitoriju odpri:

`Settings` -> `Pages`

in nastavi:

- `Source: GitHub Actions`

## Logika agregacije

Pri izboru več celic frontend:

- najprej sešteje absolutne vrednosti
- šele nato izračuna prikazane kazalnike

To velja za:

- deleže starostnih skupin
- indeks staranja
- indeks feminitete

`age_p`, `age_m` in `age_f` se agregirajo kot uteženo povprečje po velikosti ustrezne populacije.

## Trenutno stanje

V trenutnem delovnem direktoriju je zaznan vhod za leto `2024`. Ko dodaš še druga leta v mapo `podatki/`, ponovno zaženi pripravljalno skripto in aplikacija bo samodejno ponudila dodatna leta.

## Omejitve prototipa

- namenjen je statični objavi in preprostemu prototipu
- brez backend-a ni strežniškega filtriranja ali prostorske baze
- pri večjem številu let naraste velikost JSON datotek
- administrativni izbor je na voljo samo, če pripraviš tudi admin sloj
