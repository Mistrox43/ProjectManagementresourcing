# Project Workload Dashboard

A professional web-based application for visualizing and analyzing project management workload data. Upload your CSV file and instantly generate interactive insights about your team's projects, resource allocation, and timeline management.

## Features

### 📊 Visual Analytics
- **Projects Timeline**: Track project distribution over time with interactive line charts
- **Staff Workload Analysis**: View workload distribution by Project Leads and Specialists
- **Regional Distribution**: Understand project distribution across different regions
- **Status & Type Breakdown**: Analyze projects by status and type with pie/doughnut charts
- **Go-Live Timeline**: Monitor past completions and upcoming go-live dates
- **Testing Schedule**: Visualize testing duration and schedules

### 🎯 Key Metrics
- Total projects count
- Active projects tracking
- Upcoming go-lives (next 60 days)
- Projects currently in testing
- Unique project leads and specialists
- Dynamic date range display

### 🔍 Interactive Filtering
- Filter by Region
- Filter by Project Status
- Filter by Project Type
- Filter by Project Lead
- Real-time search across all project data
- Clear filters with one click

### 📋 Data Management
- Interactive data table with all project details
- Search functionality across all fields
- Export filtered data to CSV
- Responsive design for all screen sizes

## Getting Started

### Installation

No installation required! This is a standalone web application that runs entirely in your browser.

### Usage

1. **Open the Application**
   - Open `index.html` in any modern web browser
   - Supported browsers: Chrome, Firefox, Safari, Edge

2. **Upload Your Data**
   - Click "Choose CSV File" button
   - Select your project data CSV file
   - The dashboard will load automatically

3. **Explore Your Data**
   - View key metrics at the top of the dashboard
   - Use filters to focus on specific regions, statuses, or team members
   - Scroll through various charts for different insights
   - Search the data table for specific projects
   - Export filtered data for further analysis

### CSV Format

Your CSV file should include the following columns:

| Column Name | Description |
|------------|-------------|
| Closed | Project closure status |
| Site Name(s) | Site identifiers |
| Facility Name | Name of the facility/organization |
| Project Short Name | Project identifier |
| OH Region | Geographical region |
| LOB | Line of Business |
| Project Type | Type of project (Integration, New Implementation, Upgrade, etc.) |
| OH Go-Live Date | Project go-live date |
| Hospital Go-Live Date | Hospital-specific go-live date |
| Project Status | Current project status |
| OH Project Lead | Project manager (Last Name, First Name) |
| Kanban-Project Lead | Kanban board project lead |
| OH Specialist(s) | Technical resource(s) assigned |
| Charter Status | Charter completion status |
| Prelim HL7 | Preliminary HL7 status |
| Cycle 1 | Cycle 1 status |
| Cycle 2 | Cycle 2 status |
| eCTAS CAV | eCTAS CAV status |
| Kick-Off Date | Project start date |
| Testing Start | Testing phase start date |
| Testing End | Testing phase end date |
| Current Integration | Current technical state |
| Future Integration | Target technical state |
| OH Go-Live Date Confirmed | Confidence flag for go-live date |
| Baseline Testing Start | Original testing start date |
| Baseline Testing End | Original testing end date |
| Labels | Project labels/tags |

### Sample Data

A sample CSV file (`sample_data.csv`) is included with realistic project data to help you get started and test the application.

## Key Insights

### Understanding Current Workload
- **Active Projects**: View how many projects are currently in progress
- **Staff Allocation**: See which team members have the most projects assigned
- **Testing Pipeline**: Identify projects currently in testing phase

### Planning Future Workload
- **Upcoming Go-Lives**: Track projects completing in the next 60 days
- **Monthly Trends**: Understand project volume trends over time
- **Resource Planning**: Identify team members with heavy or light workloads

### Project Distribution
- **By Region**: Understand geographical distribution
- **By Type**: Analyze the mix of integration, implementation, and upgrade projects
- **By Status**: Track projects across different lifecycle stages

## Technical Details

### Technologies Used
- **HTML5**: Structure and semantics
- **CSS3**: Modern styling with CSS Grid and Flexbox
- **JavaScript (ES6+)**: Data processing and interactivity
- **Chart.js**: Interactive data visualizations
- **No Backend Required**: All processing happens in the browser

### Browser Compatibility
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

### Performance
- Handles datasets with thousands of projects
- Real-time filtering and updates
- Optimized chart rendering
- Responsive design for mobile and desktop

## Tips for Best Results

1. **Date Formatting**: Ensure dates in your CSV are in a standard format (YYYY-MM-DD, MM/DD/YYYY, etc.)
2. **Consistent Naming**: Use consistent naming for regions, statuses, and types for better filtering
3. **Complete Data**: More complete data fields result in more accurate insights
4. **Regular Updates**: Re-upload your CSV periodically to keep insights current

## Customization

### Modifying Colors
Edit the CSS variables in `styles.css`:
```css
:root {
    --primary-color: #2563eb;
    --success-color: #10b981;
    --warning-color: #f59e0b;
    /* ... */
}
```

### Adding Custom Charts
Add new chart functions in `app.js` following the existing pattern:
```javascript
function createCustomChart() {
    // Your chart logic here
}
```

## Troubleshooting

### CSV Not Loading
- Ensure the file is a valid CSV format
- Check that column headers match the expected format
- Try opening the CSV in a text editor to verify structure

### Charts Not Displaying
- Refresh the page and try again
- Check browser console for errors (F12)
- Ensure you're using a modern browser

### Filters Not Working
- Clear all filters and try again
- Reload the page and upload the CSV again
- Check that the filtered columns have data

## Support

For issues or questions:
1. Check the browser console for error messages (F12)
2. Verify your CSV format matches the expected structure
3. Try the sample data to confirm the application is working correctly

## License

This project is provided as-is for project management and workload analysis purposes.

## Version

Version 1.0.0 - Initial Release

---

Built with ❤️ for efficient project management and team workload analysis.
