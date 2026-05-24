# Crop Pattern Update

## What Changed

### ✅ New Predefined Crops Added

The crop pattern section now includes **14 predefined crops** with emojis:

| Crop | Emoji | Crop | Emoji |
|------|-------|------|-------|
| Wheat | 🌾 | Potato | 🥔 |
| Rice | 🍚 | Raya (Mustard) | 🌼 |
| Cotton | 🌿 | Vegetables | 🥦 |
| Sugarcane | 🎋 | Fruits | 🍎 |
| Maize | 🌽 | Onion | 🧅 |
| Sunflower | 🌻 | Garlic | 🧄 |
| | | Tomato | 🍅 |
| | | Chilli | 🌶 |

### ✅ Custom Crop Input Added

**New feature:** You can now add **any crop manually** that's not in the predefined list.

**How to use:**
1. Below the checkboxes, there's a text input field
2. Type the crop name (e.g., "Mung", "Moong", "Lentil", "Peas", "Barley")
3. Click **"＋ Add Crop"** button or press **Enter**
4. The crop appears as a blue tag with a ✕ button to remove it

**Example custom crops you can add:**
- Mung (Moong)
- Lentil (Masoor)
- Chickpea (Chana)
- Peas (Matar)
- Barley (Jau)
- Sesame (Til)
- Fodder crops
- Any other crop specific to your region

### How It Works

**When saving a farmer:**
- All checked predefined crops + all custom crops are saved together
- Custom crops are stored as part of the crops array

**When editing a farmer:**
- Predefined crops are automatically checked
- Custom crops (not in the predefined list) appear as blue tags
- You can add more custom crops or remove existing ones

**When viewing/exporting:**
- All crops (predefined + custom) are shown together
- No difference in how they're displayed

### Technical Details

**Files changed:**
- `index.html` — Added Potato, Raya, Onion, Garlic, Tomato, Chilli + custom input field
- `app.js` — Updated `getSelectedCrops()` and `setSelectedCrops()` to merge custom crops
- `styles.css` — Added styling for custom crop tags (blue removable badges)

**Functions added:**
- `addCustomCrop()` — Adds a custom crop from the input
- `removeCustomCrop(index)` — Removes a custom crop tag
- `renderCustomCropTags()` — Displays custom crops as removable tags

**Data structure:**
```javascript
// Example farmer with mixed crops:
{
  crops: ['Wheat', 'Rice', 'Potato', 'Mung', 'Lentil']
  //       ↑ predefined    ↑ predefined  ↑ custom crops
}
```

All crops are stored in a single array — no distinction between predefined and custom in the database.
