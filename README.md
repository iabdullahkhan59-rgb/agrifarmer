# AgriTrack - Agricultural Data Management System

A modern, responsive web application for managing farmer records and tracking fertilizer usage. Built with vanilla JavaScript, Chart.js, and localStorage for data persistence.

## 🌟 Features

### 1. **Farmer Data Entry**
- Complete farmer information form with validation
- Fields include:
  - Farmer Name
  - Contact Number
  - Location (Latitude & Longitude with interactive map picker)
  - Total Land Area (in Acres)
  - Crop Pattern (multiple selection)
  - Dealer Name
- Interactive map powered by Leaflet.js
- GPS location detection

### 2. **Fertilizer/Product Usage Tracking**
Track usage across multiple brands:

**A. Sona (FFC) Products:**
- Sona Neem Coated Urea
- Sona Zinc Coated Urea
- Sona Boron DAP

**B. Engro Products** (generic input)

**C. Fatima Fertilizer (Sarsabz)** (generic input)

**D. Yara International Products:**
- YaraLiva Tropicote
- YaraVita Bortrac
- YaraVita Crop Boost
- YaraVita Frutrel
- YaraVita Solatrel
- Yara Amplix Optitrac (Biostimulant)

For each product, track:
- Number of bags
- Purchase dealer

### 3. **Excel Upload & Export**
- **Upload**: Import farmer data from Excel (.xlsx) or CSV files
- Auto-mapping of common column names
- Preview data before importing
- **Export**: Download all farmer data as Excel file with complete product details

### 4. **Dashboard & Analytics**
- Real-time statistics:
  - Total farmers
  - Total bags sold
  - Active dealers count
  - Top brand
- Interactive charts:
  - Product usage bar chart
  - Brand distribution pie chart
  - Dealer-wise sales
  - Crop pattern distribution
- Time-based filtering (All Time, Last Week, Last Month)

### 5. **Insights Feature**
- Custom date range selection
- Comprehensive analytics:
  - Most used fertilizer/product
  - Top brand in selected period
  - Total bags sold per product
  - Most active dealer
  - Farmers count in range
- Visual charts for insights

### 6. **Farmer Management**
- Search farmers by name or contact
- View detailed farmer records
- Edit existing records
- Delete records with confirmation
- Responsive table view

## 🚀 Getting Started

### Prerequisites
- A modern web browser (Chrome, Firefox, Edge, Safari)
- No server or backend required!

### Installation

1. **Download the files** to a folder on your computer:
   - `index.html`
   - `styles.css`
   - `app.js`

2. **Open the application**:
   - Simply double-click `index.html` to open it in your default browser
   - Or right-click → Open with → Choose your browser

3. **That's it!** The application is ready to use.

### Demo Data
The application comes with 4 sample farmer records pre-loaded for demonstration purposes. You can:
- View them in the Farmers List
- Edit or delete them
- Add your own records

## 📱 Usage Guide

### Adding a Farmer
1. Click **"Add Farmer"** in the sidebar
2. Fill in the farmer information
3. Select crop patterns (multiple selection allowed)
4. Click on the map to set location, or use **"📍 Detect"** for GPS
5. Enter fertilizer usage details (bags and dealer for each product)
6. Click **"💾 Save Farmer"**

### Uploading Excel Data
1. Click **"Upload Excel"** in the sidebar
2. Drag & drop your Excel/CSV file or click **"Browse File"**
3. Preview the data (first 10 rows shown)
4. Click **"✅ Import All Records"** to add to database

**Expected Excel Columns** (case-insensitive, auto-mapped):
- Farmer Name / Name / Farmer
- Contact Number / Contact / Phone / Mobile
- Dealer Name / Dealer
- Total Land Area / Land Area / Land / Acres
- Crop Pattern / Crops / Crop (comma-separated)
- Latitude / Lat
- Longitude / Lng / Long

### Viewing Dashboard
1. Click **"Dashboard"** in the sidebar
2. Use the filter dropdown to view:
   - All Time
   - Last Week
   - Last Month
3. Charts update automatically

### Generating Insights
1. Click **"Insights"** in the sidebar
2. Select **From** and **To** dates
3. Click **"Generate Insights"**
4. View detailed analytics and charts for the selected period

### Exporting Data
1. Click **"⬇ Export Excel"** button in the top bar
2. Excel file downloads automatically with filename: `AgriTrack_Farmers_YYYY-MM-DD.xlsx`
3. Includes all farmer data and product usage details

## 💾 Data Storage

- All data is stored locally in your browser using **localStorage**
- No internet connection required after initial load
- Data persists across browser sessions
- Data is specific to the browser and device
- To backup data: Use the Export Excel feature
- To transfer data: Export from one device, import on another

## 🎨 Features Highlights

### Responsive Design
- Works on desktop, tablet, and mobile devices
- Mobile-friendly sidebar navigation
- Touch-optimized controls

### User Experience
- Clean, modern interface
- Color-coded brand sections
- Toast notifications for user feedback
- Form validation
- Confirmation dialogs for destructive actions

### Charts & Visualizations
- Bar charts for product and dealer comparisons
- Pie/Doughnut charts for distribution analysis
- Responsive charts that adapt to screen size
- Color-coded for easy identification

## 🛠️ Technology Stack

- **Frontend**: Vanilla JavaScript (ES6+)
- **UI**: HTML5, CSS3 (Custom design, no framework)
- **Charts**: Chart.js 4.4.0
- **Maps**: Leaflet.js 1.9.4
- **Excel**: SheetJS (xlsx) 0.20.1
- **Storage**: Browser localStorage
- **No Backend Required**: Fully client-side application

## 📊 Browser Compatibility

- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Edge 90+
- ✅ Safari 14+
- ✅ Opera 76+

## 🔒 Privacy & Security

- All data stays on your device
- No data is sent to external servers
- No user tracking or analytics
- No account or login required
- Complete data ownership

## 📝 Tips & Best Practices

1. **Regular Backups**: Export your data regularly using the Export Excel feature
2. **Browser Data**: Don't clear browser data if you want to keep your records
3. **Multiple Devices**: Use Export/Import to sync data across devices
4. **Data Entry**: Fill in as much detail as possible for better analytics
5. **Location**: Use the map picker or GPS detection for accurate coordinates

## 🐛 Troubleshooting

**Charts not displaying?**
- Ensure you have an internet connection for CDN resources to load
- Refresh the page

**Data disappeared?**
- Check if browser data/cache was cleared
- Restore from a previous Excel export

**Map not loading?**
- Check internet connection (Leaflet requires online tiles)
- Refresh the page

**Excel upload not working?**
- Ensure file is .xlsx or .csv format
- Check that column names match expected format
- Verify file is not corrupted

## 📄 License

This project is open source and available for educational and commercial use.

## 🤝 Support

For issues, questions, or feature requests, please refer to the documentation or contact your system administrator.

---

**Version**: 2.0  
**Last Updated**: May 2026  
**Developed for**: Agricultural field officers and data management teams
