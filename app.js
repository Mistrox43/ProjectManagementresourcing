// Global variables
let projectData = [];
let filteredData = [];
let charts = {};
let currentTab = 'current-status'; // Track active tab

// Performance optimization variables
let parsedDateCache = new Map(); // Cache for parsed dates
let filterDebounceTimer = null; // Debounce timer for filter changes
let isUpdating = false; // Flag to prevent concurrent updates
let pendingUpdate = false; // Flag to track if an update is pending

// Tab switching function
function switchTab(tabName) {
    // Update current tab
    currentTab = tabName;

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.getAttribute('data-tab') === tabName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`tab-${tabName}`).classList.add('active');

    // Render charts for the active tab
    renderTabContent(tabName);
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('csvFileInput');
    fileInput.addEventListener('change', handleFileUpload);
});

// Optimized parseDate with caching
function parseDateCached(dateString, projectId = '') {
    if (!dateString) return null;

    const cacheKey = `${projectId}_${dateString}`;

    if (parsedDateCache.has(cacheKey)) {
        return parsedDateCache.get(cacheKey);
    }

    const date = new Date(dateString);
    const result = isNaN(date.getTime()) ? null : date;
    parsedDateCache.set(cacheKey, result);

    return result;
}

// Clear date cache when new data is loaded
function clearDateCache() {
    parsedDateCache.clear();
}

// Show loading indicator
function showLoading(message = 'Updating...') {
    let loader = document.getElementById('loadingIndicator');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'loadingIndicator';
        loader.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(37, 99, 235, 0.95);
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            z-index: 10000;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            display: flex;
            align-items: center;
            gap: 10px;
        `;
        loader.innerHTML = `
            <div style="
                width: 16px;
                height: 16px;
                border: 2px solid white;
                border-top-color: transparent;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            "></div>
            <span id="loadingMessage">${message}</span>
        `;
        document.body.appendChild(loader);

        // Add animation keyframes if not already added
        if (!document.getElementById('spinAnimation')) {
            const style = document.createElement('style');
            style.id = 'spinAnimation';
            style.textContent = `
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }
    } else {
        loader.style.display = 'flex';
        document.getElementById('loadingMessage').textContent = message;
    }
}

// Hide loading indicator
function hideLoading() {
    const loader = document.getElementById('loadingIndicator');
    if (loader) {
        loader.style.display = 'none';
    }
}

// Handle CSV file upload
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const fileInfo = document.getElementById('fileInfo');
    fileInfo.textContent = `Loading ${file.name}...`;

    const reader = new FileReader();
    reader.onload = (e) => {
        const csvText = e.target.result;
        parseCSV(csvText);
        fileInfo.textContent = `✓ ${file.name} loaded successfully!`;

        setTimeout(() => {
            document.getElementById('uploadSection').style.display = 'none';
            document.getElementById('dashboard').style.display = 'block';
        }, 500);
    };
    reader.readAsText(file);
}

// Parse CSV data with proper handling of quoted fields and multi-line cells
function parseCSV(csvText) {
    const rows = [];
    const fields = [];
    let currentField = '';
    let insideQuotes = false;

    // Parse the entire CSV text character by character
    for (let i = 0; i < csvText.length; i++) {
        const char = csvText[i];
        const nextChar = csvText[i + 1];

        if (char === '"') {
            if (insideQuotes && nextChar === '"') {
                // Escaped quote inside quoted field
                currentField += '"';
                i++; // Skip next quote
            } else {
                // Toggle quote state
                insideQuotes = !insideQuotes;
            }
        } else if (char === ',' && !insideQuotes) {
            // End of field
            fields.push(currentField.trim());
            currentField = '';
        } else if ((char === '\n' || (char === '\r' && nextChar === '\n')) && !insideQuotes) {
            // End of row (only when not inside quotes)
            fields.push(currentField.trim());

            // Only add non-empty rows
            if (fields.some(f => f !== '')) {
                rows.push([...fields]);
            }

            fields.length = 0;
            currentField = '';

            // Skip \n if we just processed \r
            if (char === '\r' && nextChar === '\n') {
                i++;
            }
        } else {
            // Add character to current field (including newlines inside quotes)
            currentField += char;
        }
    }

    // Add the last field and row if there's any remaining data
    if (currentField || fields.length > 0) {
        fields.push(currentField.trim());
        if (fields.some(f => f !== '')) {
            rows.push([...fields]);
        }
    }

    // First row is the header
    if (rows.length === 0) {
        console.error('No data found in CSV');
        return;
    }

    const headers = rows[0];

    // Clear date cache when loading new data
    clearDateCache();

    // Parse data rows
    projectData = [];
    for (let i = 1; i < rows.length; i++) {
        const values = rows[i];
        const row = {};

        headers.forEach((header, index) => {
            row[header] = values[index] || '';
        });

        // Add unique ID for caching purposes
        row.__id = i;

        // Only add row if it has meaningful data
        if (Object.values(row).some(v => v !== '')) {
            projectData.push(row);
        }
    }

    filteredData = [...projectData];
    initializeDashboard();
}

// Initialize dashboard with all visualizations
function initializeDashboard() {
    populateFilters();
    updateMetrics();
    renderTabContent(currentTab);
    renderTable();
}

// Render content for active tab
function renderTabContent(tabName) {
    if (tabName === 'current-status') {
        createLeadWorkloadChart();
        createSpecialistWorkloadChart();
        createRegionChart();
        createStatusChart();
        createTypeChart();
    } else if (tabName === 'timeline-planning') {
        createTimelineChart();
        populateLeadTimelineSelect();
        populateSpecialistTimelineSelect();
        createLeadTimelineChart();
        createSpecialistTimelineChart();
        createGoLiveChart();
        createTestingChart();
    } else if (tabName === 'data-operations') {
        // Data & Operations tab only needs table which is always rendered
        // No charts in this tab
    }
}

// Populate filter dropdowns
function populateFilters() {
    const regions = [...new Set(projectData.map(p => p['OH Region']).filter(r => r))];
    const statuses = [...new Set(projectData.map(p => p['Project Status']).filter(s => s))];
    const types = [...new Set(projectData.map(p => p['Project Type']).filter(t => t))];
    const lobs = [...new Set(projectData.map(p => p['LOB']).filter(l => l))];
    const leads = [...new Set(projectData.map(p => p['OH Project Lead']).filter(l => l))];

    populateSelect('regionFilter', regions);
    populateSelect('statusFilter', statuses);
    populateSelect('typeFilter', types);
    populateSelect('lobFilter', lobs);
    populateSelect('leadFilter', leads);
}

function populateSelect(id, options) {
    const select = document.getElementById(id);
    // Get currently selected values
    const currentValues = Array.from(select.selectedOptions).map(opt => opt.value);

    // Keep "All" option
    select.innerHTML = `<option value="all">${select.options[0].text}</option>`;

    options.sort().forEach(option => {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option;
        select.appendChild(opt);
    });

    // Restore previous selections if they still exist in the new options
    if (currentValues.length > 0) {
        Array.from(select.options).forEach(option => {
            if (currentValues.includes(option.value) && (option.value === 'all' || options.includes(option.value))) {
                option.selected = true;
            }
        });
    } else {
        // If nothing was selected, select "All" by default
        select.options[0].selected = true;
    }
}

// Update key metrics - OPTIMIZED: Single pass through data
function updateMetrics() {
    const now = new Date();
    const sixtyDaysFromNow = new Date(now.getTime() + (60 * 24 * 60 * 60 * 1000));

    // Initialize counters
    let activeProjects = 0;
    let upcomingGoLives = 0;
    let inTesting = 0;
    let missingGoLive = 0;
    let missingKickOff = 0;
    let missingAnyDate = 0;
    let missingTestStart = 0;
    let missingTestEnd = 0;
    let missingAnyTestDate = 0;
    let testingNotRequired = 0;

    const uniqueLeads = new Set();
    const uniqueSpecialists = new Set();
    const validDates = [];

    // Single pass through all filtered data
    filteredData.forEach(p => {
        // Parse dates once with caching
        const goLiveDate = parseDateCached(p['OH Go-Live Date'], p.__id);
        const kickOffDate = parseDateCached(p['Kick-Off Date'], p.__id);
        const testStartDate = parseDateCached(p['Testing Start'], p.__id);
        const testEndDate = parseDateCached(p['Testing End'], p.__id);

        // Active projects
        const status = p['Project Status'];
        if (status && !status.toLowerCase().includes('complete') && !status.toLowerCase().includes('closed')) {
            activeProjects++;
        }

        // Unique leads and specialists
        if (p['OH Project Lead']) uniqueLeads.add(p['OH Project Lead']);
        if (p['OH Specialist(s)']) uniqueSpecialists.add(p['OH Specialist(s)']);

        // Upcoming go-lives
        if (goLiveDate && goLiveDate > now && goLiveDate <= sixtyDaysFromNow) {
            upcomingGoLives++;
        }

        // Projects in testing
        if (testStartDate && testEndDate && testStartDate <= now && testEndDate >= now) {
            inTesting++;
        }

        // Missing dates
        if (!goLiveDate) missingGoLive++;
        if (!kickOffDate) missingKickOff++;
        if (!goLiveDate || !kickOffDate) missingAnyDate++;

        // Missing testing dates
        if (!testStartDate) missingTestStart++;
        if (!testEndDate) missingTestEnd++;
        if (!testStartDate || !testEndDate) missingAnyTestDate++;

        // Testing not required
        const missingTestDates = !testStartDate || !testEndDate;
        if (missingTestDates) {
            const prelimHL7 = (p['Prelim HL7'] || '').trim();
            const cycle1 = (p['Cycle 1'] || '').trim();
            const cycle2 = (p['Cycle 2'] || '').trim();
            const eCTASCAV = (p['eCTAS CAV'] || '').trim();

            if (prelimHL7 === 'Not Required' && cycle1 === 'Not Required' &&
                cycle2 === 'Not Required' && eCTASCAV === 'Not Required') {
                testingNotRequired++;
            }
        }

        // Collect valid dates for range
        if (goLiveDate) validDates.push(goLiveDate);
    });

    const totalProjects = filteredData.length;

    // Date range
    let dateRangeText = 'No date data';
    if (validDates.length > 0) {
        const minDate = new Date(Math.min(...validDates));
        const maxDate = new Date(Math.max(...validDates));
        dateRangeText = `${formatDate(minDate)} - ${formatDate(maxDate)}`;
    }
    document.getElementById('dateRangeDisplay').textContent = dateRangeText;

    // Tab 1: Current Status metrics
    const currentMetrics = [
        { label: 'Total Projects', value: totalProjects, subtitle: 'All projects', clickable: false },
        { label: 'Active Projects', value: activeProjects, subtitle: 'In progress', clickable: false },
        { label: 'Project Leads', value: uniqueLeads.size, subtitle: 'Unique leads', clickable: false },
        { label: 'Specialists', value: uniqueSpecialists.size, subtitle: 'Unique specialists', clickable: false }
    ];

    // Tab 2: Timeline & Planning metrics
    const timelineMetrics = [
        { label: 'Upcoming Go-Lives', value: upcomingGoLives, subtitle: 'Next 60 days', clickable: false },
        { label: 'In Testing', value: inTesting, subtitle: 'Currently testing', clickable: false }
    ];

    // Tab 3: Data & Operations metrics
    const dataMetrics = [
        { label: 'Missing Date Data', value: missingAnyDate, subtitle: `Go-Live: ${missingGoLive}, Kick-Off: ${missingKickOff}`, clickable: true },
        { label: 'Missing Testing Dates', value: missingAnyTestDate, subtitle: `Test Start: ${missingTestStart}, Test End: ${missingTestEnd}, Not Required: ${testingNotRequired}`, clickable: true }
    ];

    // Populate metrics for each tab
    const metricsGridCurrent = document.getElementById('metricsGridCurrent');
    const metricsGridTimeline = document.getElementById('metricsGridTimeline');
    const metricsGridData = document.getElementById('metricsGridData');

    if (metricsGridCurrent) {
        metricsGridCurrent.innerHTML = currentMetrics.map(m => `
            <div class="metric-card ${m.clickable ? 'metric-card-clickable' : ''}" ${m.clickable ? `onclick="${m.label === 'Missing Date Data' ? 'openMissingDatesPanel()' : 'openMissingTestingDatesPanel()'}"` : ''}>
                <div class="metric-label">${m.label}</div>
                <div class="metric-value">${m.value}</div>
                <div class="metric-subtitle">${m.subtitle}</div>
            </div>
        `).join('');
    }

    if (metricsGridTimeline) {
        metricsGridTimeline.innerHTML = timelineMetrics.map(m => `
            <div class="metric-card ${m.clickable ? 'metric-card-clickable' : ''}" ${m.clickable ? `onclick="${m.label === 'Missing Date Data' ? 'openMissingDatesPanel()' : 'openMissingTestingDatesPanel()'}"` : ''}>
                <div class="metric-label">${m.label}</div>
                <div class="metric-value">${m.value}</div>
                <div class="metric-subtitle">${m.subtitle}</div>
            </div>
        `).join('');
    }

    if (metricsGridData) {
        metricsGridData.innerHTML = dataMetrics.map(m => `
            <div class="metric-card ${m.clickable ? 'metric-card-clickable' : ''}" ${m.clickable ? `onclick="${m.label === 'Missing Date Data' ? 'openMissingDatesPanel()' : 'openMissingTestingDatesPanel()'}"` : ''}>
                <div class="metric-label">${m.label}</div>
                <div class="metric-value">${m.value}</div>
                <div class="metric-subtitle">${m.subtitle}</div>
            </div>
        `).join('');
    }
}

// Create all charts - Now uses renderTabContent for active tab only
async function createCharts() {
    // Render content for current active tab
    renderTabContent(currentTab);
}

// Timeline Chart - Concurrent Active Projects and Testing over time
function createTimelineChart() {
    destroyChart('timelineChart');

    // Get selected granularity
    const granularity = document.querySelector('input[name="mainTimelineGranularity"]:checked')?.value || 'month';

    // Collect all projects with valid kick-off and go-live dates
    const projectsWithDates = filteredData
        .map(project => ({
            kickOff: parseDateCached(project['Kick-Off Date'], project.__id),
            goLive: parseDateCached(project['OH Go-Live Date'], project.__id),
            testStart: parseDateCached(project['Testing Start'], project.__id),
            testEnd: parseDateCached(project['Testing End'], project.__id),
            project: project
        }))
        .filter(p => p.kickOff && p.goLive);

    // Collect projects with valid testing dates
    const projectsWithTestingDates = filteredData
        .map(project => ({
            testStart: parseDateCached(project['Testing Start'], project.__id),
            testEnd: parseDateCached(project['Testing End'], project.__id),
            project: project
        }))
        .filter(p => p.testStart && p.testEnd);

    if (projectsWithDates.length === 0) {
        // No valid date data, show empty chart
        const ctx = document.getElementById('timelineChart').getContext('2d');
        charts.timelineChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['No Data'],
                datasets: [{
                    label: 'Active Projects',
                    data: [0],
                    borderColor: '#2563eb',
                    backgroundColor: 'rgba(37, 99, 235, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            }
        });
        return;
    }

    // Find the overall date range (including testing dates)
    const allDates = [];
    projectsWithDates.forEach(p => {
        allDates.push(p.kickOff, p.goLive);
    });
    projectsWithTestingDates.forEach(p => {
        allDates.push(p.testStart, p.testEnd);
    });

    const minDate = new Date(Math.min(...allDates));
    const maxDate = new Date(Math.max(...allDates));

    // Generate date ranges based on granularity
    const periods = generateDateRanges(minDate, maxDate, granularity);

    // For each period, count how many projects are active (Kick-Off to Go-Live)
    const activeProjectCounts = periods.map(period => {
        const periodEnd = getPeriodEnd(period, granularity);

        return projectsWithDates.filter(p => {
            // Project is active if it started on or before the end of this period
            // AND ends on or after the start of this period
            return p.kickOff <= periodEnd && p.goLive >= period;
        }).length;
    });

    // For each period, count how many projects are in testing (Testing Start to Testing End)
    const testingProjectCounts = periods.map(period => {
        const periodEnd = getPeriodEnd(period, granularity);

        return projectsWithTestingDates.filter(p => {
            // Project is in testing if it started testing on or before the end of this period
            // AND finished testing on or after the start of this period
            return p.testStart <= periodEnd && p.testEnd >= period;
        }).length;
    });

    // Format labels based on granularity
    const labels = periods.map(p => formatPeriodLabel(p, granularity));

    const ctx = document.getElementById('timelineChart').getContext('2d');
    charts.timelineChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Active Projects',
                    data: activeProjectCounts,
                    borderColor: '#2563eb',
                    backgroundColor: 'rgba(37, 99, 235, 0.1)',
                    tension: 0.4,
                    fill: true,
                    borderWidth: 2,
                    pointRadius: 3,
                    pointHoverRadius: 5
                },
                {
                    label: 'Projects in Testing',
                    data: testingProjectCounts,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    tension: 0.4,
                    fill: true,
                    borderWidth: 2,
                    pointRadius: 3,
                    pointHoverRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const periodIndex = elements[0].index;
                    openSidePanel('main-timeline', periodIndex, periods, { activeProjectCounts, testingProjectCounts });
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    },
                    title: {
                        display: true,
                        text: 'Number of Projects'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Timeline'
                    }
                }
            }
        }
    });
}

// Lead Workload Chart
function createLeadWorkloadChart() {
    destroyChart('leadWorkloadChart');

    const leadCounts = {};
    filteredData.forEach(project => {
        const lead = project['OH Project Lead'];
        if (lead) {
            leadCounts[lead] = (leadCounts[lead] || 0) + 1;
        }
    });

    const sortedLeads = Object.entries(leadCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    const ctx = document.getElementById('leadWorkloadChart').getContext('2d');
    charts.leadWorkloadChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sortedLeads.map(l => l[0]),
            datasets: [{
                label: 'Projects',
                data: sortedLeads.map(l => l[1]),
                backgroundColor: '#10b981'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            indexAxis: 'y',
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });
}

// Specialist Workload Chart
function createSpecialistWorkloadChart() {
    destroyChart('specialistWorkloadChart');

    const specialistCounts = {};
    filteredData.forEach(project => {
        const specialists = project['OH Specialist(s)'];
        if (specialists) {
            // Handle multiple specialists separated by semicolon or comma
            const specialistList = specialists.split(/[;,]/).map(s => s.trim()).filter(s => s);
            specialistList.forEach(specialist => {
                specialistCounts[specialist] = (specialistCounts[specialist] || 0) + 1;
            });
        }
    });

    const sortedSpecialists = Object.entries(specialistCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    const ctx = document.getElementById('specialistWorkloadChart').getContext('2d');
    charts.specialistWorkloadChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sortedSpecialists.map(s => s[0]),
            datasets: [{
                label: 'Projects',
                data: sortedSpecialists.map(s => s[1]),
                backgroundColor: '#f59e0b'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            indexAxis: 'y',
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });
}

// Populate Lead Timeline Select
function populateLeadTimelineSelect() {
    const leads = [...new Set(filteredData.map(p => p['OH Project Lead']).filter(l => l))].sort();
    const select = document.getElementById('leadTimelineSelect');
    select.innerHTML = leads.map(lead =>
        `<option value="${lead}" selected>${lead}</option>`
    ).join('');
}

// Populate Specialist Timeline Select
function populateSpecialistTimelineSelect() {
    const specialistSet = new Set();
    filteredData.forEach(project => {
        const specialists = project['OH Specialist(s)'];
        if (specialists) {
            const specialistList = specialists.split(/[;,]/).map(s => s.trim()).filter(s => s);
            specialistList.forEach(s => specialistSet.add(s));
        }
    });
    const specialists = [...specialistSet].sort();
    const select = document.getElementById('specialistTimelineSelect');
    select.innerHTML = specialists.map(specialist =>
        `<option value="${specialist}" selected>${specialist}</option>`
    ).join('');
}

// Select/Deselect functions for Lead Timeline
function selectAllLeads() {
    const select = document.getElementById('leadTimelineSelect');
    for (let option of select.options) {
        option.selected = true;
    }
    createLeadTimelineChart();
}

function deselectAllLeads() {
    const select = document.getElementById('leadTimelineSelect');
    for (let option of select.options) {
        option.selected = false;
    }
    createLeadTimelineChart();
}

// Select/Deselect functions for Specialist Timeline
function selectAllSpecialists() {
    const select = document.getElementById('specialistTimelineSelect');
    for (let option of select.options) {
        option.selected = true;
    }
    createSpecialistTimelineChart();
}

function deselectAllSpecialists() {
    const select = document.getElementById('specialistTimelineSelect');
    for (let option of select.options) {
        option.selected = false;
    }
    createSpecialistTimelineChart();
}

// Project Lead Workload Over Time Chart
function createLeadTimelineChart() {
    destroyChart('leadTimelineChart');

    const select = document.getElementById('leadTimelineSelect');
    const selectedLeads = Array.from(select.selectedOptions).map(opt => opt.value);

    // Get selected timeline type and granularity
    const timelineType = document.querySelector('input[name="leadTimelineType"]:checked').value;
    const granularity = document.querySelector('input[name="leadTimelineGranularity"]:checked')?.value || 'month';

    if (selectedLeads.length === 0) {
        return;
    }

    // Get all projects with dates for selected leads
    const leadProjectData = {};
    const leadTestingData = {};

    selectedLeads.forEach(lead => {
        // Project lifecycle data
        leadProjectData[lead] = filteredData
            .filter(p => p['OH Project Lead'] === lead)
            .map(project => ({
                kickOff: parseDateCached(project['Kick-Off Date'], project.__id),
                goLive: parseDateCached(project['OH Go-Live Date'], project.__id),
                project: project
            }))
            .filter(p => p.kickOff && p.goLive);

        // Testing phase data
        leadTestingData[lead] = filteredData
            .filter(p => p['OH Project Lead'] === lead)
            .map(project => ({
                testStart: parseDateCached(project['Testing Start'], project.__id),
                testEnd: parseDateCached(project['Testing End'], project.__id),
                project: project
            }))
            .filter(p => p.testStart && p.testEnd);
    });

    // Find overall date range based on timeline type
    const allDates = [];

    if (timelineType === 'project' || timelineType === 'both') {
        Object.values(leadProjectData).forEach(projects => {
            projects.forEach(p => {
                allDates.push(p.kickOff, p.goLive);
            });
        });
    }

    if (timelineType === 'testing' || timelineType === 'both') {
        Object.values(leadTestingData).forEach(projects => {
            projects.forEach(p => {
                allDates.push(p.testStart, p.testEnd);
            });
        });
    }

    if (allDates.length === 0) {
        return;
    }

    const minDate = new Date(Math.min(...allDates));
    const maxDate = new Date(Math.max(...allDates));

    // Generate date ranges based on granularity
    const periods = generateDateRanges(minDate, maxDate, granularity);

    // Create datasets based on timeline type
    const colors = [
        '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
        '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#14b8a6'
    ];

    const datasets = [];
    let datasetIndex = 0;

    selectedLeads.forEach((lead, leadIndex) => {
        // Project lifecycle line
        if (timelineType === 'project' || timelineType === 'both') {
            const projectCounts = periods.map(period => {
                const periodEnd = getPeriodEnd(period, granularity);
                return leadProjectData[lead].filter(p => {
                    return p.kickOff <= periodEnd && p.goLive >= period;
                }).length;
            });

            datasets.push({
                label: timelineType === 'both' ? `${lead} (Project)` : lead,
                data: projectCounts,
                borderColor: colors[leadIndex % colors.length],
                backgroundColor: colors[leadIndex % colors.length] + '20',
                tension: 0.4,
                borderWidth: 2,
                pointRadius: 3,
                pointHoverRadius: 5,
                borderDash: []
            });
        }

        // Testing phase line
        if (timelineType === 'testing' || timelineType === 'both') {
            const testingCounts = periods.map(period => {
                const periodEnd = getPeriodEnd(period, granularity);
                return leadTestingData[lead].filter(p => {
                    return p.testStart <= periodEnd && p.testEnd >= period;
                }).length;
            });

            datasets.push({
                label: timelineType === 'both' ? `${lead} (Testing)` : lead,
                data: testingCounts,
                borderColor: colors[leadIndex % colors.length],
                backgroundColor: colors[leadIndex % colors.length] + '20',
                tension: 0.4,
                borderWidth: 2,
                pointRadius: 3,
                pointHoverRadius: 5,
                borderDash: timelineType === 'both' ? [5, 5] : []
            });
        }
    });

    const labels = periods.map(p => formatPeriodLabel(p, granularity));

    const ctx = document.getElementById('leadTimelineChart').getContext('2d');
    charts.leadTimelineChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const periodIndex = elements[0].index;
                    openSidePanel('lead-timeline', periodIndex, periods, { selectedLeads, timelineType });
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    },
                    title: {
                        display: true,
                        text: 'Concurrent Projects'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Timeline'
                    }
                }
            }
        }
    });
}

// Specialist Workload Over Time Chart
function createSpecialistTimelineChart() {
    destroyChart('specialistTimelineChart');

    const select = document.getElementById('specialistTimelineSelect');
    const selectedSpecialists = Array.from(select.selectedOptions).map(opt => opt.value);

    // Get selected timeline type and granularity
    const timelineType = document.querySelector('input[name="specialistTimelineType"]:checked').value;
    const granularity = document.querySelector('input[name="specialistTimelineGranularity"]:checked')?.value || 'month';

    if (selectedSpecialists.length === 0) {
        return;
    }

    // Get all projects with dates for selected specialists
    const specialistProjectData = {};
    const specialistTestingData = {};

    selectedSpecialists.forEach(specialist => {
        specialistProjectData[specialist] = [];
        specialistTestingData[specialist] = [];

        filteredData.forEach(project => {
            const specialists = project['OH Specialist(s)'];
            if (specialists) {
                const specialistList = specialists.split(/[;,]/).map(s => s.trim()).filter(s => s);
                if (specialistList.includes(specialist)) {
                    // Project lifecycle data
                    const kickOff = parseDateCached(project['Kick-Off Date'], project.__id);
                    const goLive = parseDateCached(project['OH Go-Live Date'], project.__id);
                    if (kickOff && goLive) {
                        specialistProjectData[specialist].push({
                            kickOff: kickOff,
                            goLive: goLive,
                            project: project
                        });
                    }

                    // Testing phase data
                    const testStart = parseDateCached(project['Testing Start'], project.__id);
                    const testEnd = parseDateCached(project['Testing End'], project.__id);
                    if (testStart && testEnd) {
                        specialistTestingData[specialist].push({
                            testStart: testStart,
                            testEnd: testEnd,
                            project: project
                        });
                    }
                }
            }
        });
    });

    // Find overall date range based on timeline type
    const allDates = [];

    if (timelineType === 'project' || timelineType === 'both') {
        Object.values(specialistProjectData).forEach(projects => {
            projects.forEach(p => {
                allDates.push(p.kickOff, p.goLive);
            });
        });
    }

    if (timelineType === 'testing' || timelineType === 'both') {
        Object.values(specialistTestingData).forEach(projects => {
            projects.forEach(p => {
                allDates.push(p.testStart, p.testEnd);
            });
        });
    }

    if (allDates.length === 0) {
        return;
    }

    const minDate = new Date(Math.min(...allDates));
    const maxDate = new Date(Math.max(...allDates));

    // Generate date ranges based on granularity
    const periods = generateDateRanges(minDate, maxDate, granularity);

    // Create datasets based on timeline type
    const colors = [
        '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
        '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#14b8a6'
    ];

    const datasets = [];

    selectedSpecialists.forEach((specialist, specialistIndex) => {
        // Project lifecycle line
        if (timelineType === 'project' || timelineType === 'both') {
            const projectCounts = periods.map(period => {
                const periodEnd = getPeriodEnd(period, granularity);
                return specialistProjectData[specialist].filter(p => {
                    return p.kickOff <= periodEnd && p.goLive >= period;
                }).length;
            });

            datasets.push({
                label: timelineType === 'both' ? `${specialist} (Project)` : specialist,
                data: projectCounts,
                borderColor: colors[specialistIndex % colors.length],
                backgroundColor: colors[specialistIndex % colors.length] + '20',
                tension: 0.4,
                borderWidth: 2,
                pointRadius: 3,
                pointHoverRadius: 5,
                borderDash: []
            });
        }

        // Testing phase line
        if (timelineType === 'testing' || timelineType === 'both') {
            const testingCounts = periods.map(period => {
                const periodEnd = getPeriodEnd(period, granularity);
                return specialistTestingData[specialist].filter(p => {
                    return p.testStart <= periodEnd && p.testEnd >= period;
                }).length;
            });

            datasets.push({
                label: timelineType === 'both' ? `${specialist} (Testing)` : specialist,
                data: testingCounts,
                borderColor: colors[specialistIndex % colors.length],
                backgroundColor: colors[specialistIndex % colors.length] + '20',
                tension: 0.4,
                borderWidth: 2,
                pointRadius: 3,
                pointHoverRadius: 5,
                borderDash: timelineType === 'both' ? [5, 5] : []
            });
        }
    });

    const labels = periods.map(p => formatPeriodLabel(p, granularity));

    const ctx = document.getElementById('specialistTimelineChart').getContext('2d');
    charts.specialistTimelineChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const periodIndex = elements[0].index;
                    openSidePanel('specialist-timeline', periodIndex, periods, { selectedSpecialists, timelineType });
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    },
                    title: {
                        display: true,
                        text: 'Concurrent Projects'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Timeline'
                    }
                }
            }
        }
    });
}

// Region Chart
function createRegionChart() {
    destroyChart('regionChart');

    const regionCounts = {};
    filteredData.forEach(project => {
        const region = project['OH Region'];
        if (region) {
            regionCounts[region] = (regionCounts[region] || 0) + 1;
        }
    });

    const ctx = document.getElementById('regionChart').getContext('2d');
    charts.regionChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(regionCounts),
            datasets: [{
                data: Object.values(regionCounts),
                backgroundColor: [
                    '#2563eb',
                    '#10b981',
                    '#f59e0b',
                    '#ef4444',
                    '#8b5cf6',
                    '#ec4899',
                    '#06b6d4',
                    '#84cc16'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

// Status Chart
function createStatusChart() {
    destroyChart('statusChart');

    const statusCounts = {};
    filteredData.forEach(project => {
        const status = project['Project Status'];
        if (status) {
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        }
    });

    const ctx = document.getElementById('statusChart').getContext('2d');
    charts.statusChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: Object.keys(statusCounts),
            datasets: [{
                data: Object.values(statusCounts),
                backgroundColor: [
                    '#10b981',
                    '#f59e0b',
                    '#2563eb',
                    '#ef4444',
                    '#8b5cf6',
                    '#ec4899'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

// Type Chart
function createTypeChart() {
    destroyChart('typeChart');

    const typeCounts = {};
    filteredData.forEach(project => {
        const type = project['Project Type'];
        if (type) {
            typeCounts[type] = (typeCounts[type] || 0) + 1;
        }
    });

    const ctx = document.getElementById('typeChart').getContext('2d');
    charts.typeChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(typeCounts),
            datasets: [{
                label: 'Projects',
                data: Object.values(typeCounts),
                backgroundColor: '#8b5cf6'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });
}

// Go-Live Chart - Monthly trend
function createGoLiveChart() {
    destroyChart('goLiveChart');

    const monthlyData = {};
    const now = new Date();

    filteredData.forEach(project => {
        const goLiveDate = parseDateCached(project['OH Go-Live Date'], project.__id);
        if (goLiveDate) {
            const monthKey = `${goLiveDate.getFullYear()}-${String(goLiveDate.getMonth() + 1).padStart(2, '0')}`;
            if (!monthlyData[monthKey]) {
                monthlyData[monthKey] = { past: 0, future: 0 };
            }
            if (goLiveDate < now) {
                monthlyData[monthKey].past++;
            } else {
                monthlyData[monthKey].future++;
            }
        }
    });

    const sortedMonths = Object.keys(monthlyData).sort();
    const labels = sortedMonths.map(m => {
        const [year, month] = m.split('-');
        return `${getMonthName(parseInt(month) - 1)} ${year}`;
    });
    const pastValues = sortedMonths.map(m => monthlyData[m].past);
    const futureValues = sortedMonths.map(m => monthlyData[m].future);

    const ctx = document.getElementById('goLiveChart').getContext('2d');
    charts.goLiveChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Completed',
                    data: pastValues,
                    backgroundColor: '#10b981'
                },
                {
                    label: 'Upcoming',
                    data: futureValues,
                    backgroundColor: '#f59e0b'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                x: {
                    stacked: true
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });
}

// Testing Chart
function createTestingChart() {
    destroyChart('testingChart');

    const testingData = [];
    const now = new Date();

    filteredData.forEach((project, index) => {
        const testStart = parseDateCached(project['Testing Start'], project.__id);
        const testEnd = parseDateCached(project['Testing End'], project.__id);

        if (testStart && testEnd && testEnd >= now) {
            testingData.push({
                project: project['Facility Name'] || project['Project Short Name'] || `Project ${index}`,
                start: testStart,
                end: testEnd,
                lead: project['OH Project Lead'] || 'Unknown'
            });
        }
    });

    // Sort by start date and take top 15
    testingData.sort((a, b) => a.start - b.start);
    const topTesting = testingData.slice(0, 15);

    const labels = topTesting.map(t => t.project.substring(0, 30));
    const durations = topTesting.map(t => Math.ceil((t.end - t.start) / (1000 * 60 * 60 * 24)));

    const ctx = document.getElementById('testingChart').getContext('2d');
    charts.testingChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Testing Duration (Days)',
                data: durations,
                backgroundColor: '#06b6d4'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            indexAxis: 'y',
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    beginAtZero: true
                }
            }
        }
    });
}

// Render data table
function renderTable() {
    const table = document.getElementById('projectTable');
    const thead = document.getElementById('tableHeader');
    const tbody = document.getElementById('tableBody');

    if (filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="100%">No data to display</td></tr>';
        return;
    }

    // Key columns to display
    const displayColumns = [
        'Facility Name',
        'Project Short Name',
        'OH Region',
        'Project Type',
        'OH Go-Live Date',
        'Project Status',
        'OH Project Lead',
        'OH Specialist(s)',
        'Testing Start',
        'Testing End'
    ];

    // Create header
    thead.innerHTML = '<tr>' + displayColumns.map(col => `<th>${col}</th>`).join('') + '</tr>';

    // Create rows
    tbody.innerHTML = filteredData.map(project => {
        return '<tr>' + displayColumns.map(col => {
            let value = project[col] || '-';

            // Format status with badge
            if (col === 'Project Status' && value !== '-') {
                const statusClass = getStatusClass(value);
                value = `<span class="status-badge ${statusClass}">${value}</span>`;
            }

            return `<td>${value}</td>`;
        }).join('') + '</tr>';
    }).join('');
}

// Filter table by search
function filterTable() {
    const searchTerm = document.getElementById('searchBox').value.toLowerCase();
    const rows = document.querySelectorAll('#tableBody tr');

    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(searchTerm) ? '' : 'none';
    });
}

// Apply filters - OPTIMIZED: Debounced with async chart updates
function applyFilters() {
    // Clear any pending filter updates
    if (filterDebounceTimer) {
        clearTimeout(filterDebounceTimer);
    }

    // Debounce filter application to prevent rapid successive calls
    filterDebounceTimer = setTimeout(() => {
        showLoading('Applying filters...');

        try {
            // Get selected values from multi-select filters
            const regionFilter = Array.from(document.getElementById('regionFilter').selectedOptions).map(opt => opt.value);
            const statusFilter = Array.from(document.getElementById('statusFilter').selectedOptions).map(opt => opt.value);
            const typeFilter = Array.from(document.getElementById('typeFilter').selectedOptions).map(opt => opt.value);
            const lobFilter = Array.from(document.getElementById('lobFilter').selectedOptions).map(opt => opt.value);
            const leadFilter = Array.from(document.getElementById('leadFilter').selectedOptions).map(opt => opt.value);

            // Apply filters to data
            filteredData = projectData.filter(project => {
                return (regionFilter.includes('all') || regionFilter.includes(project['OH Region'])) &&
                       (statusFilter.includes('all') || statusFilter.includes(project['Project Status'])) &&
                       (typeFilter.includes('all') || typeFilter.includes(project['Project Type'])) &&
                       (lobFilter.includes('all') || lobFilter.includes(project['LOB'])) &&
                       (leadFilter.includes('all') || leadFilter.includes(project['OH Project Lead']));
            });

            // Update UI components
            updateMetrics();
            renderTabContent(currentTab);
            renderTable();

        } finally {
            hideLoading();
        }
    }, 300); // 300ms debounce delay
}

// Clear all filters - OPTIMIZED: Async with loading indicator
function clearFilters() {
    showLoading('Clearing filters...');

    try {
        // Clear multi-select filters by deselecting all and selecting only "all"
        ['regionFilter', 'statusFilter', 'typeFilter', 'lobFilter', 'leadFilter'].forEach(filterId => {
            const select = document.getElementById(filterId);
            Array.from(select.options).forEach(option => {
                option.selected = (option.value === 'all');
            });
        });

        document.getElementById('searchBox').value = '';

        filteredData = [...projectData];
        updateMetrics();
        renderTabContent(currentTab);
        renderTable();

    } finally {
        hideLoading();
    }
}

// Reset dashboard
function resetDashboard() {
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('uploadSection').style.display = 'flex';
    document.getElementById('csvFileInput').value = '';
    document.getElementById('fileInfo').textContent = '';

    projectData = [];
    filteredData = [];

    Object.values(charts).forEach(chart => chart.destroy());
    charts = {};
}

// Export filtered data to CSV
function exportToCSV() {
    if (filteredData.length === 0) {
        alert('No data to export');
        return;
    }

    const headers = Object.keys(filteredData[0]);
    const csvContent = [
        headers.join(','),
        ...filteredData.map(row =>
            headers.map(header => {
                const value = row[header] || '';
                return `"${value.toString().replace(/"/g, '""')}"`;
            }).join(',')
        )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `filtered_projects_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

// Utility functions
function parseDate(dateString) {
    if (!dateString) return null;
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
    if (!date) return '';
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function getMonthName(monthIndex) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[monthIndex];
}

function getStatusClass(status) {
    const lower = status.toLowerCase();
    if (lower.includes('complete') || lower.includes('closed')) return 'status-completed';
    if (lower.includes('active') || lower.includes('progress')) return 'status-active';
    if (lower.includes('hold') || lower.includes('pending')) return 'status-pending';
    return 'status-active';
}

function destroyChart(chartId) {
    if (charts[chartId]) {
        charts[chartId].destroy();
    }
}

// Granularity Helper Functions
function generateDateRanges(minDate, maxDate, granularity) {
    const ranges = [];
    let currentDate = new Date(minDate);

    if (granularity === 'day') {
        // Generate daily ranges
        while (currentDate <= maxDate) {
            ranges.push(new Date(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }
    } else if (granularity === 'week') {
        // Generate weekly ranges (start on Monday)
        // First, find the Monday of the week containing minDate
        const firstMonday = new Date(minDate);
        const dayOfWeek = firstMonday.getDay();
        const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        firstMonday.setDate(firstMonday.getDate() + daysToMonday);

        currentDate = new Date(firstMonday);
        while (currentDate <= maxDate) {
            ranges.push(new Date(currentDate));
            currentDate.setDate(currentDate.getDate() + 7);
        }
    } else {
        // Generate monthly ranges (default)
        currentDate = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
        const endMonth = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);

        while (currentDate <= endMonth) {
            ranges.push(new Date(currentDate));
            currentDate.setMonth(currentDate.getMonth() + 1);
        }
    }

    return ranges;
}

function formatPeriodLabel(date, granularity) {
    if (granularity === 'day') {
        return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
    } else if (granularity === 'week') {
        const weekEnd = new Date(date);
        weekEnd.setDate(weekEnd.getDate() + 6);
        return `${date.getMonth() + 1}/${date.getDate()}-${weekEnd.getMonth() + 1}/${weekEnd.getDate()}`;
    } else {
        return `${getMonthName(date.getMonth())} ${date.getFullYear()}`;
    }
}

function getPeriodEnd(date, granularity) {
    const endDate = new Date(date);

    if (granularity === 'day') {
        // End of the same day
        endDate.setHours(23, 59, 59, 999);
    } else if (granularity === 'week') {
        // End of the week (Sunday)
        endDate.setDate(endDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);
    } else {
        // End of the month
        endDate.setMonth(endDate.getMonth() + 1);
        endDate.setDate(0);
        endDate.setHours(23, 59, 59, 999);
    }

    return endDate;
}

// Side Panel State
let sidePanelState = {
    isOpen: false,
    chartType: null,
    monthIndex: null,
    allMonths: [],
    chartData: null
};

// Open Side Panel
function openSidePanel(chartType, monthIndex, months, chartData) {
    sidePanelState = {
        isOpen: true,
        chartType: chartType,
        monthIndex: monthIndex,
        allMonths: months,
        chartData: chartData
    };

    document.getElementById('sidePanel').classList.add('open');
    document.getElementById('sidePanelOverlay').classList.add('open');

    updateSidePanelContent();
}

// Open Missing Dates Panel
function openMissingDatesPanel() {
    sidePanelState = {
        isOpen: true,
        chartType: 'missing-dates',
        monthIndex: 0,
        allMonths: [],
        chartData: null
    };

    document.getElementById('sidePanel').classList.add('open');
    document.getElementById('sidePanelOverlay').classList.add('open');

    updateSidePanelContent();
}

// Open Missing Testing Dates Panel
function openMissingTestingDatesPanel() {
    sidePanelState = {
        isOpen: true,
        chartType: 'missing-testing-dates',
        monthIndex: 0,
        allMonths: [],
        chartData: null
    };

    document.getElementById('sidePanel').classList.add('open');
    document.getElementById('sidePanelOverlay').classList.add('open');

    updateSidePanelContent();
}

// Close Side Panel
function closeSidePanel() {
    document.getElementById('sidePanel').classList.remove('open');
    document.getElementById('sidePanelOverlay').classList.remove('open');

    sidePanelState.isOpen = false;
}

// Navigate Period
function navigatePeriod(direction) {
    if (direction === 'prev' && sidePanelState.monthIndex > 0) {
        sidePanelState.monthIndex--;
        updateSidePanelContent();
    } else if (direction === 'next' && sidePanelState.monthIndex < sidePanelState.allMonths.length - 1) {
        sidePanelState.monthIndex++;
        updateSidePanelContent();
    }
}

// Update Side Panel Content
function updateSidePanelContent() {
    // Handle missing dates panel separately
    if (sidePanelState.chartType === 'missing-dates') {
        document.getElementById('panelTitle').textContent = 'Projects with Missing Date Data';
        document.querySelector('.panel-navigation').style.display = 'none';

        // Get projects with missing dates
        const missingGoLiveProjects = filteredData.filter(p => !parseDateCached(p['OH Go-Live Date'], p.__id));
        const missingKickOffProjects = filteredData.filter(p => !parseDateCached(p['Kick-Off Date'], p.__id));
        const missingBothProjects = filteredData.filter(p =>
            !parseDateCached(p['OH Go-Live Date'], p.__id) && !parseDateCached(p['Kick-Off Date'], p.__id)
        );
        const missingAnyProjects = filteredData.filter(p =>
            !parseDateCached(p['OH Go-Live Date'], p.__id) || !parseDateCached(p['Kick-Off Date'], p.__id)
        );

        // Update summary stats
        const summaryHTML = `
            <div class="panel-stat">
                <div class="panel-stat-label">Missing Any Date</div>
                <div class="panel-stat-value">${missingAnyProjects.length}</div>
            </div>
            <div class="panel-stat">
                <div class="panel-stat-label">Missing Go-Live</div>
                <div class="panel-stat-value">${missingGoLiveProjects.length}</div>
            </div>
            <div class="panel-stat">
                <div class="panel-stat-label">Missing Kick-Off</div>
                <div class="panel-stat-value">${missingKickOffProjects.length}</div>
            </div>
            <div class="panel-stat">
                <div class="panel-stat-label">Missing Both</div>
                <div class="panel-stat-value">${missingBothProjects.length}</div>
            </div>
        `;
        document.getElementById('panelSummary').innerHTML = summaryHTML;

        // Display all projects with missing dates
        if (missingAnyProjects.length === 0) {
            document.getElementById('panelProjects').innerHTML = `
                <div class="panel-empty">
                    <div class="panel-empty-icon">✓</div>
                    <p>All projects have complete date data!</p>
                </div>
            `;
        } else {
            const projectsHTML = missingAnyProjects.map(project => {
                const facilityName = project['Facility Name'] || 'Unknown Facility';
                const projectShortName = project['Project Short Name'] || '';
                const projectLead = project['OH Project Lead'] || 'Not Assigned';
                const specialist = project['OH Specialist(s)'] || 'Not Assigned';
                const status = project['Project Status'] || 'Unknown';
                const region = project['OH Region'] || 'Unknown';
                const projectType = project['Project Type'] || 'Unknown';
                const lob = project['LOB'] || 'Unknown';

                const kickOffDate = parseDateCached(project['Kick-Off Date'], project.__id);
                const goLiveDate = parseDateCached(project['OH Go-Live Date'], project.__id);

                const statusClass = getStatusClass(status);

                const missingDates = [];
                if (!kickOffDate) missingDates.push('Kick-Off Date');
                if (!goLiveDate) missingDates.push('Go-Live Date');

                return `
                    <div class="project-card">
                        <div class="project-card-header">
                            <h4 class="project-name">${facilityName}</h4>
                            <span class="status-badge ${statusClass}">${status}</span>
                        </div>
                        <div class="project-card-body">
                            ${projectShortName ? `<div class="project-info-row">
                                <span class="project-info-label">Project:</span>
                                <span class="project-info-value">${projectShortName}</span>
                            </div>` : ''}
                            <div class="project-info-row">
                                <span class="project-info-label">Type:</span>
                                <span class="project-info-value">${projectType}</span>
                            </div>
                            <div class="project-info-row">
                                <span class="project-info-label">Region:</span>
                                <span class="project-info-value">${region}</span>
                            </div>
                            <div class="project-info-row">
                                <span class="project-info-label">LOB:</span>
                                <span class="project-info-value">${lob}</span>
                            </div>
                            <div class="project-info-row">
                                <span class="project-info-label">Project Lead:</span>
                                <span class="project-info-value">${projectLead}</span>
                            </div>
                            <div class="project-info-row">
                                <span class="project-info-label">Specialist:</span>
                                <span class="project-info-value">${specialist}</span>
                            </div>
                        </div>
                        <div class="project-missing-dates">
                            <div class="missing-dates-label">Missing Dates:</div>
                            <div class="missing-dates-list">
                                ${missingDates.map(d => `<span class="missing-date-badge">${d}</span>`).join('')}
                            </div>
                            ${kickOffDate ? `<div class="date-info">Kick-Off: ${formatDate(kickOffDate)}</div>` : ''}
                            ${goLiveDate ? `<div class="date-info">Go-Live: ${formatDate(goLiveDate)}</div>` : ''}
                        </div>
                    </div>
                `;
            }).join('');

            document.getElementById('panelProjects').innerHTML = projectsHTML;
        }
        return;
    }

    // Handle missing testing dates panel separately
    if (sidePanelState.chartType === 'missing-testing-dates') {
        document.getElementById('panelTitle').textContent = 'Projects with Missing Testing Date Data';
        document.querySelector('.panel-navigation').style.display = 'none';

        // Get projects with missing testing dates
        const missingTestStartProjects = filteredData.filter(p => !parseDateCached(p['Testing Start'], p.__id));
        const missingTestEndProjects = filteredData.filter(p => !parseDateCached(p['Testing End'], p.__id));
        const missingBothProjects = filteredData.filter(p =>
            !parseDateCached(p['Testing Start'], p.__id) && !parseDateCached(p['Testing End'], p.__id)
        );
        const missingAnyProjects = filteredData.filter(p =>
            !parseDateCached(p['Testing Start'], p.__id) || !parseDateCached(p['Testing End'], p.__id)
        );

        // Update summary stats
        const summaryHTML = `
            <div class="panel-stat">
                <div class="panel-stat-label">Missing Any Test Date</div>
                <div class="panel-stat-value">${missingAnyProjects.length}</div>
            </div>
            <div class="panel-stat">
                <div class="panel-stat-label">Missing Test Start</div>
                <div class="panel-stat-value">${missingTestStartProjects.length}</div>
            </div>
            <div class="panel-stat">
                <div class="panel-stat-label">Missing Test End</div>
                <div class="panel-stat-value">${missingTestEndProjects.length}</div>
            </div>
            <div class="panel-stat">
                <div class="panel-stat-label">Missing Both</div>
                <div class="panel-stat-value">${missingBothProjects.length}</div>
            </div>
        `;
        document.getElementById('panelSummary').innerHTML = summaryHTML;

        // Display all projects with missing testing dates
        if (missingAnyProjects.length === 0) {
            document.getElementById('panelProjects').innerHTML = `
                <div class="panel-empty">
                    <div class="panel-empty-icon">✓</div>
                    <p>All projects have complete testing date data!</p>
                </div>
            `;
        } else {
            const projectsHTML = missingAnyProjects.map(project => {
                const facilityName = project['Facility Name'] || 'Unknown Facility';
                const projectShortName = project['Project Short Name'] || '';
                const projectLead = project['OH Project Lead'] || 'Not Assigned';
                const specialist = project['OH Specialist(s)'] || 'Not Assigned';
                const status = project['Project Status'] || 'Unknown';
                const region = project['OH Region'] || 'Unknown';
                const projectType = project['Project Type'] || 'Unknown';
                const lob = project['LOB'] || 'Unknown';

                const testStartDate = parseDateCached(project['Testing Start'], project.__id);
                const testEndDate = parseDateCached(project['Testing End'], project.__id);

                const statusClass = getStatusClass(status);

                const missingDates = [];
                if (!testStartDate) missingDates.push('Testing Start');
                if (!testEndDate) missingDates.push('Testing End');

                return `
                    <div class="project-card">
                        <div class="project-card-header">
                            <h4 class="project-name">${facilityName}</h4>
                            <span class="status-badge ${statusClass}">${status}</span>
                        </div>
                        <div class="project-card-body">
                            ${projectShortName ? `<div class="project-info-row">
                                <span class="project-info-label">Project:</span>
                                <span class="project-info-value">${projectShortName}</span>
                            </div>` : ''}
                            <div class="project-info-row">
                                <span class="project-info-label">Type:</span>
                                <span class="project-info-value">${projectType}</span>
                            </div>
                            <div class="project-info-row">
                                <span class="project-info-label">Region:</span>
                                <span class="project-info-value">${region}</span>
                            </div>
                            <div class="project-info-row">
                                <span class="project-info-label">LOB:</span>
                                <span class="project-info-value">${lob}</span>
                            </div>
                            <div class="project-info-row">
                                <span class="project-info-label">Project Lead:</span>
                                <span class="project-info-value">${projectLead}</span>
                            </div>
                            <div class="project-info-row">
                                <span class="project-info-label">Specialist:</span>
                                <span class="project-info-value">${specialist}</span>
                            </div>
                        </div>
                        <div class="project-missing-dates">
                            <div class="missing-dates-label">Missing Testing Dates:</div>
                            <div class="missing-dates-list">
                                ${missingDates.map(d => `<span class="missing-date-badge">${d}</span>`).join('')}
                            </div>
                            ${testStartDate ? `<div class="date-info">Testing Start: ${formatDate(testStartDate)}</div>` : ''}
                            ${testEndDate ? `<div class="date-info">Testing End: ${formatDate(testEndDate)}</div>` : ''}
                        </div>
                    </div>
                `;
            }).join('');

            document.getElementById('panelProjects').innerHTML = projectsHTML;
        }
        return;
    }

    // Handle timeline panels
    document.querySelector('.panel-navigation').style.display = 'flex';

    const month = sidePanelState.allMonths[sidePanelState.monthIndex];
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const monthLabel = `${getMonthName(month.getMonth())} ${month.getFullYear()}`;

    // Update title and current period
    document.getElementById('panelTitle').textContent = `Projects Active in ${monthLabel}`;
    document.getElementById('currentPeriod').textContent = monthLabel;

    // Get active projects for this month
    let activeProjects = [];
    let testingProjects = [];

    if (sidePanelState.chartType === 'main-timeline') {
        // Active projects
        activeProjects = filteredData.filter(p => {
            const kickOff = parseDateCached(p['Kick-Off Date'], p.__id);
            const goLive = parseDateCached(p['OH Go-Live Date'], p.__id);
            return kickOff && goLive && kickOff <= monthEnd && goLive >= month;
        });

        // Testing projects
        testingProjects = filteredData.filter(p => {
            const testStart = parseDateCached(p['Testing Start'], p.__id);
            const testEnd = parseDateCached(p['Testing End'], p.__id);
            return testStart && testEnd && testStart <= monthEnd && testEnd >= month;
        });
    } else if (sidePanelState.chartType === 'lead-timeline') {
        // For individual lead timeline
        const timelineType = document.querySelector('input[name="leadTimelineType"]:checked').value;
        const selectedLeads = Array.from(document.getElementById('leadTimelineSelect').selectedOptions).map(opt => opt.value);

        if (timelineType === 'project' || timelineType === 'both') {
            activeProjects = filteredData.filter(p => {
                const kickOff = parseDateCached(p['Kick-Off Date'], p.__id);
                const goLive = parseDateCached(p['OH Go-Live Date'], p.__id);
                const isSelectedLead = selectedLeads.includes(p['OH Project Lead']);
                return kickOff && goLive && kickOff <= monthEnd && goLive >= month && isSelectedLead;
            });
        }

        if (timelineType === 'testing' || timelineType === 'both') {
            testingProjects = filteredData.filter(p => {
                const testStart = parseDateCached(p['Testing Start'], p.__id);
                const testEnd = parseDateCached(p['Testing End'], p.__id);
                const isSelectedLead = selectedLeads.includes(p['OH Project Lead']);
                return testStart && testEnd && testStart <= monthEnd && testEnd >= month && isSelectedLead;
            });
        }
    } else if (sidePanelState.chartType === 'specialist-timeline') {
        // For individual specialist timeline
        const timelineType = document.querySelector('input[name="specialistTimelineType"]:checked').value;
        const selectedSpecialists = Array.from(document.getElementById('specialistTimelineSelect').selectedOptions).map(opt => opt.value);

        filteredData.forEach(p => {
            const specialists = p['OH Specialist(s)'];
            if (specialists) {
                const specialistList = specialists.split(/[;,]/).map(s => s.trim()).filter(s => s);
                const hasSelectedSpecialist = specialistList.some(s => selectedSpecialists.includes(s));

                if (hasSelectedSpecialist) {
                    if (timelineType === 'project' || timelineType === 'both') {
                        const kickOff = parseDateCached(p['Kick-Off Date'], p.__id);
                        const goLive = parseDateCached(p['OH Go-Live Date'], p.__id);
                        if (kickOff && goLive && kickOff <= monthEnd && goLive >= month) {
                            activeProjects.push(p);
                        }
                    }

                    if (timelineType === 'testing' || timelineType === 'both') {
                        const testStart = parseDateCached(p['Testing Start'], p.__id);
                        const testEnd = parseDateCached(p['Testing End'], p.__id);
                        if (testStart && testEnd && testStart <= monthEnd && testEnd >= month) {
                            testingProjects.push(p);
                        }
                    }
                }
            }
        });
    }

    // Update summary stats
    const summaryHTML = `
        <div class="panel-stat">
            <div class="panel-stat-label">Active Projects</div>
            <div class="panel-stat-value">${activeProjects.length}</div>
        </div>
        <div class="panel-stat">
            <div class="panel-stat-label">In Testing</div>
            <div class="panel-stat-value">${testingProjects.length}</div>
        </div>
    `;
    document.getElementById('panelSummary').innerHTML = summaryHTML;

    // Combine and deduplicate projects
    const allProjects = [...new Set([...activeProjects, ...testingProjects])];

    // Sort projects by Facility Name
    allProjects.sort((a, b) => {
        const nameA = (a['Facility Name'] || 'Unknown').toLowerCase();
        const nameB = (b['Facility Name'] || 'Unknown').toLowerCase();
        return nameA.localeCompare(nameB);
    });

    // Update projects list
    if (allProjects.length === 0) {
        document.getElementById('panelProjects').innerHTML = `
            <div class="panel-empty">
                <div class="panel-empty-icon">📋</div>
                <p>No projects active during this period</p>
            </div>
        `;
    } else {
        const projectsHTML = allProjects.map(project => {
            const facilityName = project['Facility Name'] || 'Unknown Facility';
            const projectShortName = project['Project Short Name'] || '';
            const projectLead = project['OH Project Lead'] || 'Not Assigned';
            const specialist = project['OH Specialist(s)'] || 'Not Assigned';
            const status = project['Project Status'] || 'Unknown';
            const region = project['OH Region'] || 'Unknown';
            const projectType = project['Project Type'] || 'Unknown';
            const lob = project['LOB'] || 'Unknown';

            const kickOff = parseDateCached(project['Kick-Off Date'], project.__id);
            const goLive = parseDateCached(project['OH Go-Live Date'], project.__id);
            const testStart = parseDateCached(project['Testing Start'], project.__id);
            const testEnd = parseDateCached(project['Testing End'], project.__id);

            const isActive = kickOff && goLive && kickOff <= monthEnd && goLive >= month;
            const isTesting = testStart && testEnd && testStart <= monthEnd && testEnd >= month;

            const statusClass = getStatusClass(status);

            return `
                <div class="project-card">
                    <div class="project-card-header">
                        <h4 class="project-name">${facilityName}</h4>
                        <span class="status-badge ${statusClass}">${status}</span>
                    </div>
                    <div class="project-card-body">
                        ${projectShortName ? `<div class="project-info-row">
                            <span class="project-info-label">Project:</span>
                            <span class="project-info-value">${projectShortName}</span>
                        </div>` : ''}
                        <div class="project-info-row">
                            <span class="project-info-label">Type:</span>
                            <span class="project-info-value">${projectType}</span>
                        </div>
                        <div class="project-info-row">
                            <span class="project-info-label">Region:</span>
                            <span class="project-info-value">${region}</span>
                        </div>
                        <div class="project-info-row">
                            <span class="project-info-label">LOB:</span>
                            <span class="project-info-value">${lob}</span>
                        </div>
                        <div class="project-info-row">
                            <span class="project-info-label">Project Lead:</span>
                            <span class="project-info-value">${projectLead}</span>
                        </div>
                        <div class="project-info-row">
                            <span class="project-info-label">Specialist:</span>
                            <span class="project-info-value">${specialist}</span>
                        </div>
                    </div>
                    <div class="project-timeline">
                        ${isActive ? `
                            <div class="timeline-bar">
                                <span class="timeline-label">Project:</span>
                                <div class="timeline-visual"></div>
                                <span class="timeline-dates">${formatDate(kickOff)} - ${formatDate(goLive)}</span>
                            </div>
                        ` : ''}
                        ${isTesting ? `
                            <div class="timeline-bar">
                                <span class="timeline-label">Testing:</span>
                                <div class="timeline-visual" style="background: linear-gradient(90deg, var(--warning-color), var(--success-color));"></div>
                                <span class="timeline-dates">${formatDate(testStart)} - ${formatDate(testEnd)}</span>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');

        document.getElementById('panelProjects').innerHTML = projectsHTML;
    }

    // Update navigation buttons
    const prevBtn = document.querySelector('.btn-nav:first-child');
    const nextBtn = document.querySelector('.btn-nav:last-child');

    if (prevBtn && nextBtn) {
        prevBtn.disabled = sidePanelState.monthIndex === 0;
        nextBtn.disabled = sidePanelState.monthIndex === sidePanelState.allMonths.length - 1;
    }
}
