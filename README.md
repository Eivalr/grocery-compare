# KaloKalatho 🛒

**Σύγκριση τιμών supermarket** — Greek grocery price comparator

A standalone single-page app that fetches real-time prices from the official Greek government price observatory (e-katanalotis.gov.gr) and shows you where to shop for the cheapest basket.

## Features

- 🔍 Search across 17,000+ products from the official catalog
- 🛒 Build a custom grocery list
- 📊 Compare total basket cost across all major supermarket chains
- 💡 Optimal solution — which store saves you the most
- 📱 Mobile-friendly responsive layout
- ⚡ Zero dependencies — pure HTML/CSS/JS

## Data source

Prices come from the **e-katanalotis.gov.gr** platform (Greek Ministry of Development), which aggregates daily prices from all major chains:
- Σκλαβενίτης, ΑΒ Βασιλόπουλος, My Market, Μασούτης, Lidl, Κρητικός, and more
- Updated every day at 10:00
- Powered by [Warply](https://warp.ly) backend

## How to use

1. Open `index.html` in any browser (or deploy to GitHub Pages)
2. Search for a product and add it to your list
3. Click **Σύγκριση τιμών**
4. See prices per store and the optimal choice

## Deploy to GitHub Pages

1. Fork or upload this repo
2. Go to **Settings → Pages**
3. Set source to `main` branch, root folder
4. Your app will be live at `https://yourusername.github.io/grocery-compare/`

## Technical notes

The app uses the Warply API (underpinning e-katanalotis.gov.gr):

```
POST https://engage.warp.ly/api/mobile/v2/ed840ad545884deeb6c6b699176797ed/context/
```

**Get product catalog:**
```json
{ "products": { "action": "retrieve_multilingual", "merchant_id": 4994, "active": true, "language": "el" } }
```

**Get prices per store for a product:**
```json
{ "products": { "action": "product_history", "barcode": "BARCODE_HERE" } }
```

Returns `Avg_min_price_per_day` → array of daily prices with `Min_Markets` (prices per chain).

## Fallback mode

When the e-katanalotis server is temporarily unavailable, the app shows estimated prices based on historical averages with a clear notice to the user.

## License

MIT — free to use, fork, and adapt.
