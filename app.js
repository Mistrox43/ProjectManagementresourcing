// Global variables
let projectData = [];
let filteredData = [];
let charts = {};
let currentTab = 'current-status'; // Track active tab

// Filter state for tag-based filters
let activeFilters = {
    region: [],
    status: [],
    type: [],
    lob: [],
    lead: [],
    specialist: []
};

let filterOptions = {
    region: [],
    status: [],
    type: [],
    lob: [],
    lead: [],
    specialist: []
};

// Capacity Planning configuration
let capacityConfig = {
    defaultLeadCapacity: 5,
    defaultSpecialistCapacity: 8,
    alertThreshold: 80,
    individualOverrides: {},
    phaseWeights: {
        lead: {
            preKickoff30Plus: 10,      // Pre-Kickoff (>30 days)
            preKickoff0to30: 30,        // Pre-Kickoff (0-30 days)
            activePreTesting: 100,      // Active Pre-Testing
            activeTesting: 80,          // Active Testing
            activePostTesting: 60,      // Active Post-Testing
            postGoLive0to30: 20,        // Post-Go-Live (0-30 days)
            postGoLive30Plus: 5         // Post-Go-Live (>30 days)
        },
        specialist: {
            preKickoff30Plus: 5,        // Pre-Kickoff (>30 days)
            preKickoff0to30: 20,        // Pre-Kickoff (0-30 days)
            activePreTesting: 70,       // Active Pre-Testing
            activeTesting: 100,         // Active Testing
            activePostTesting: 80,      // Active Post-Testing
            postGoLive0to30: 30,        // Post-Go-Live (0-30 days)
            postGoLive30Plus: 10        // Post-Go-Live (>30 days)
        }
    }
};

let currentCapacityFilter = 'all'; // Current capacity view filter
let expandedCapacityCards = new Set(); // Track which capacity cards are expanded

// Performance optimization variables
let parsedDateCache = new Map(); // Cache for parsed dates
let filterDebounceTimer = null; // Debounce timer for filter changes
let isUpdating = false; // Flag to prevent concurrent updates
let pendingUpdate = false; // Flag to track if an update is pending

/**
 * Parse specialist field and return the last specialist only.
 * Format: "Last name, First Name;Last name, First Name"
 * Returns the last specialist in the list to avoid double-counting projects.
 * @param {string} specialistField - The OH Specialist(s) field value
 * @returns {string|null} - The last specialist name or null if empty
 */
function getAssignedSpecialist(specialistField) {
    if (!specialistField || !specialistField.trim()) {
        return null;
    }

    // Split on semicolon or comma followed by a capital letter (to handle "Last, First;Last, First" format)
    // This preserves "Last, First" as a single entity while splitting on semicolons
    const specialists = specialistField.split(';').map(s => s.trim()).filter(s => s);

    // Return the last specialist in the list
    return specialists.length > 0 ? specialists[specialists.length - 1] : null;
}

/**
 * Get all unique specialists from the specialist field.
 * This is used for dropdown/filter population only.
 * @param {string} specialistField - The OH Specialist(s) field value
 * @returns {Array<string>} - Array of all specialist names
 */
function getAllSpecialistsFromField(specialistField) {
    if (!specialistField || !specialistField.trim()) {
        return [];
    }

    // Split on semicolon to get all specialists
    return specialistField.split(';').map(s => s.trim()).filter(s => s);
}

// Determine project phase based on dates
function determineProjectPhase(project) {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));

    // Parse all required dates
    const kickOffDate = parseDateCached(project['Kick-Off Date'], project.__id);
    const testStartDate = parseDateCached(project['Testing Start'], project.__id);
    const testEndDate = parseDateCached(project['Testing End'], project.__id);
    const goLiveDate = parseDateCached(project['OH Go-Live Date'], project.__id);

    // Check if project status is closed/complete
    const status = project['Project Status'];
    const isClosed = status && (status.toLowerCase().includes('complete') || status.toLowerCase().includes('closed'));

    // Validate date sequence: Kick-off < Testing Start < Testing End < Go-Live
    let dateSequenceError = null;
    if (kickOffDate && testStartDate && kickOffDate >= testStartDate) {
        dateSequenceError = 'Kick-off date must be before Testing Start';
    } else if (testStartDate && testEndDate && testStartDate > testEndDate) {
        dateSequenceError = 'Testing Start must be before Testing End';
    } else if (testEndDate && goLiveDate && testEndDate >= goLiveDate) {
        dateSequenceError = 'Testing End must be before Go-Live';
    } else if (kickOffDate && goLiveDate && kickOffDate >= goLiveDate) {
        dateSequenceError = 'Kick-off must be before Go-Live';
    }

    // If dates are invalid or project is closed, return appropriate phase
    if (dateSequenceError) {
        return {
            phase: 'dateError',
            phaseName: 'Date Sequence Error',
            error: dateSequenceError
        };
    }

    if (isClosed) {
        return {
            phase: 'closed',
            phaseName: 'Closed/Complete',
            error: null
        };
    }

    // Determine phase based on date ranges
    // Phase 1: Pre-Kickoff (>30 days)
    if (kickOffDate && kickOffDate > thirtyDaysFromNow) {
        return {
            phase: 'preKickoff30Plus',
            phaseName: 'Pre-Kickoff (>30 days)',
            error: null
        };
    }

    // Phase 2: Pre-Kickoff (0-30 days)
    if (kickOffDate && kickOffDate > now && kickOffDate <= thirtyDaysFromNow) {
        return {
            phase: 'preKickoff0to30',
            phaseName: 'Pre-Kickoff (0-30 days)',
            error: null
        };
    }

    // Phase 3: Active Pre-Testing
    if (kickOffDate && kickOffDate <= now) {
        if (!testStartDate || testStartDate > now) {
            return {
                phase: 'activePreTesting',
                phaseName: 'Active Pre-Testing',
                error: null
            };
        }
    }

    // Phase 4: Active Testing
    if (testStartDate && testEndDate && testStartDate <= now && testEndDate >= now) {
        return {
            phase: 'activeTesting',
            phaseName: 'Active Testing',
            error: null
        };
    }

    // Phase 5: Active Post-Testing
    if (testEndDate && testEndDate < now) {
        if (!goLiveDate || goLiveDate > now) {
            return {
                phase: 'activePostTesting',
                phaseName: 'Active Post-Testing',
                error: null
            };
        }
    }

    // Phase 6: Post-Go-Live (0-30 days)
    if (goLiveDate && goLiveDate < now && goLiveDate >= thirtyDaysAgo) {
        return {
            phase: 'postGoLive0to30',
            phaseName: 'Post-Go-Live (0-30 days)',
            error: null
        };
    }

    // Phase 7: Post-Go-Live (>30 days)
    if (goLiveDate && goLiveDate < thirtyDaysAgo) {
        return {
            phase: 'postGoLive30Plus',
            phaseName: 'Post-Go-Live (>30 days)',
            error: null
        };
    }

    // Unknown phase - missing critical dates
    return {
        phase: 'unknown',
        phaseName: 'Unknown Phase',
        error: 'Missing critical date information'
    };
}

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

    // Load capacity configuration from localStorage
    loadCapacityConfig();
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
        createLobChart();
    } else if (tabName === 'timeline-planning') {
        createTimelineChart();
        populateLeadTimelineSelect();
        populateSpecialistTimelineSelect();
        createLeadTimelineChart();
        createSpecialistTimelineChart();
        createGoLiveChart();
        createTestingChart();
    } else if (tabName === 'capacity-planning') {
        renderCapacityPlanning();
    } else if (tabName === 'data-operations') {
        // Data & Operations tab only needs table which is always rendered
        // No charts in this tab
    }
}

// Populate filter dropdowns
function populateFilters() {
    const regions = [...new Set(projectData.map(p => p['OH Region']).filter(r => r))].sort();
    const statuses = [...new Set(projectData.map(p => p['Project Status']).filter(s => s))].sort();
    const types = [...new Set(projectData.map(p => p['Project Type']).filter(t => t))].sort();
    const lobs = [...new Set(projectData.map(p => p['LOB']).filter(l => l))].sort();
    const leads = [...new Set(projectData.map(p => p['OH Project Lead']).filter(l => l))].sort();

    // Get all unique specialists from all projects
    const specialistSet = new Set();
    projectData.forEach(p => {
        const allSpecialists = getAllSpecialistsFromField(p['OH Specialist(s)']);
        allSpecialists.forEach(s => specialistSet.add(s));
    });
    const specialists = [...specialistSet].sort();

    filterOptions.region = regions;
    filterOptions.status = statuses;
    filterOptions.type = types;
    filterOptions.lob = lobs;
    filterOptions.lead = leads;
    filterOptions.specialist = specialists;

    populateFilterDropdown('regionFilterOptions', 'region', regions);
    populateFilterDropdown('statusFilterOptions', 'status', statuses);
    populateFilterDropdown('typeFilterOptions', 'type', types);
    populateFilterDropdown('lobFilterOptions', 'lob', lobs);
    populateFilterDropdown('leadFilterOptions', 'lead', leads);
    populateFilterDropdown('specialistFilterOptions', 'specialist', specialists);

    updateActiveFiltersDisplay();
}

function populateFilterDropdown(containerId, filterType, options) {
    const container = document.getElementById(containerId);
    container.innerHTML = options.map(option => `
        <div class="filter-option" onclick="toggleFilterOption('${filterType}', '${option.replace(/'/g, "\\'")}')">
            <input type="checkbox" id="${filterType}-${option.replace(/[^a-zA-Z0-9]/g, '_')}"
                   ${activeFilters[filterType].includes(option) ? 'checked' : ''}>
            <label for="${filterType}-${option.replace(/[^a-zA-Z0-9]/g, '_')}">${option}</label>
        </div>
    `).join('');
}

// Toggle filter dropdown (kept for backwards compatibility if needed)
function toggleFilterDropdown() {
    const dropdown = document.getElementById('filterDropdown');
    if (dropdown) {
        dropdown.classList.toggle('open');

        // Close dropdown when clicking outside
        if (dropdown.classList.contains('open')) {
            setTimeout(() => {
                document.addEventListener('click', closeDropdownOnClickOutside);
            }, 0);
        } else {
            document.removeEventListener('click', closeDropdownOnClickOutside);
        }
    }
}

// Toggle category-specific dropdown
function toggleCategoryDropdown(category) {
    const dropdownId = category + 'Dropdown';
    const dropdown = document.getElementById(dropdownId);

    if (!dropdown) return;

    // Close all other dropdowns first
    const allDropdowns = document.querySelectorAll('.filter-dropdown');
    allDropdowns.forEach(dd => {
        if (dd.id !== dropdownId) {
            dd.classList.remove('open');
        }
    });

    // Toggle the clicked dropdown
    dropdown.classList.toggle('open');

    // Close dropdown when clicking outside
    if (dropdown.classList.contains('open')) {
        setTimeout(() => {
            document.addEventListener('click', closeDropdownOnClickOutside);
        }, 0);
    } else {
        document.removeEventListener('click', closeDropdownOnClickOutside);
    }
}

function closeDropdownOnClickOutside(event) {
    // Check for old single dropdown (backwards compatibility)
    const dropdown = document.getElementById('filterDropdown');
    const button = document.querySelector('.btn-add-filter');

    if (dropdown && button) {
        if (!dropdown.contains(event.target) && !button.contains(event.target)) {
            dropdown.classList.remove('open');
            document.removeEventListener('click', closeDropdownOnClickOutside);
            return;
        }
    }

    // Check for new category dropdowns
    const allDropdowns = document.querySelectorAll('.filter-dropdown.open');
    const allButtons = document.querySelectorAll('.btn-filter-category');

    let clickedInsideDropdown = false;
    let clickedButton = false;

    allDropdowns.forEach(dd => {
        if (dd.contains(event.target)) {
            clickedInsideDropdown = true;
        }
    });

    allButtons.forEach(btn => {
        if (btn.contains(event.target)) {
            clickedButton = true;
        }
    });

    // If clicked outside all dropdowns and buttons, close all dropdowns
    if (!clickedInsideDropdown && !clickedButton) {
        allDropdowns.forEach(dd => {
            dd.classList.remove('open');
        });
        document.removeEventListener('click', closeDropdownOnClickOutside);
    }
}

// Toggle individual filter option
function toggleFilterOption(filterType, value) {
    const index = activeFilters[filterType].indexOf(value);

    if (index === -1) {
        activeFilters[filterType].push(value);
    } else {
        activeFilters[filterType].splice(index, 1);
    }

    // Update only the specific checkbox to keep dropdown open for multi-select
    // (Full dropdown refresh happens in removeFilterTag for periodic sync)
    const checkboxId = `${filterType}-${value.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const checkbox = document.getElementById(checkboxId);
    if (checkbox) {
        checkbox.checked = activeFilters[filterType].includes(value);
    }

    updateActiveFiltersDisplay();
    applyFilters();
}

// Remove filter tag
function removeFilterTag(filterType, value) {
    const index = activeFilters[filterType].indexOf(value);
    if (index !== -1) {
        activeFilters[filterType].splice(index, 1);
    }

    // Update checkbox state in dropdown
    populateFilterDropdown(`${filterType}FilterOptions`, filterType, filterOptions[filterType]);

    updateActiveFiltersDisplay();
    applyFilters();
}

// Update active filters display
function updateActiveFiltersDisplay() {
    const container = document.getElementById('activeFilters');
    const tags = [];

    const categoryLabels = {
        region: 'Region',
        status: 'Status',
        type: 'Type',
        lob: 'LOB',
        lead: 'Lead',
        specialist: 'Specialist'
    };

    Object.keys(activeFilters).forEach(filterType => {
        activeFilters[filterType].forEach(value => {
            tags.push(`
                <div class="filter-tag">
                    <span class="filter-tag-category">${categoryLabels[filterType]}:</span>
                    <span>${value}</span>
                    <button class="filter-tag-remove" onclick="removeFilterTag('${filterType}', '${value.replace(/'/g, "\\'")}')">×</button>
                </div>
            `);
        });
    });

    if (tags.length === 0) {
        container.innerHTML = '<span class="no-filters-msg">No filters applied</span>';
    } else {
        container.innerHTML = tags.join('');
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
    let noLead = 0;
    let noSpecialists = 0;
    let multipleSpecialists = 0;
    let dateSequenceErrors = 0;
    let postGoLive30PlusNonComplete = 0;

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

        // Check for date sequence errors
        const phaseInfo = determineProjectPhase(p);
        if (phaseInfo.phase === 'dateError') {
            dateSequenceErrors++;
        }

        // Active projects
        const status = p['Project Status'];
        if (status && !status.toLowerCase().includes('complete') && !status.toLowerCase().includes('closed')) {
            activeProjects++;
        }

        // Post-Go-Live (>30 days) with non-complete status
        if (phaseInfo.phase === 'postGoLive30Plus') {
            if (status && !status.toLowerCase().includes('complete')) {
                postGoLive30PlusNonComplete++;
            }
        }

        // Unique leads and specialists
        if (p['OH Project Lead']) uniqueLeads.add(p['OH Project Lead']);
        // Get all unique specialists from the field for counting purposes
        const allSpecialistsInField = getAllSpecialistsFromField(p['OH Specialist(s)']);
        allSpecialistsInField.forEach(specialist => uniqueSpecialists.add(specialist));

        // Projects without lead
        if (!p['OH Project Lead'] || p['OH Project Lead'].trim() === '') {
            noLead++;
        }

        // Specialist assignment issues
        const specialists = p['OH Specialist(s)'];
        if (!specialists || specialists.trim() === '') {
            noSpecialists++;
        } else if (specialists.includes(',') || specialists.includes(';')) {
            // Check for multiple specialists (separated by comma or semicolon)
            multipleSpecialists++;
        }

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
    const specialistIssues = noSpecialists + multipleSpecialists;
    const dataMetrics = [
        { label: 'Missing Date Data', value: missingAnyDate, subtitle: `Go-Live: ${missingGoLive}, Kick-Off: ${missingKickOff}`, clickable: true },
        { label: 'Missing Testing Dates', value: missingAnyTestDate, subtitle: `Test Start: ${missingTestStart}, Test End: ${missingTestEnd}, Not Required: ${testingNotRequired}`, clickable: true },
        { label: 'Date Sequence Errors', value: dateSequenceErrors, subtitle: 'Invalid date order', clickable: true },
        { label: 'Projects Without Lead', value: noLead, subtitle: 'No lead assigned', clickable: true },
        { label: 'Specialist Assignment Issues', value: specialistIssues, subtitle: `No Specialists: ${noSpecialists}, Multiple Specialists: ${multipleSpecialists}`, clickable: true },
        { label: 'Post-Go-Live >30 Days (Not Complete)', value: postGoLive30PlusNonComplete, subtitle: 'Still active after 30+ days', clickable: true }
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
        metricsGridData.innerHTML = dataMetrics.map(m => {
            let clickHandler = '';
            if (m.clickable) {
                if (m.label === 'Missing Date Data') {
                    clickHandler = 'openMissingDatesPanel()';
                } else if (m.label === 'Missing Testing Dates') {
                    clickHandler = 'openMissingTestingDatesPanel()';
                } else if (m.label === 'Date Sequence Errors') {
                    clickHandler = 'openDateSequenceErrorsPanel()';
                } else if (m.label === 'Projects Without Lead') {
                    clickHandler = 'openNoLeadPanel()';
                } else if (m.label === 'Specialist Assignment Issues') {
                    clickHandler = 'openSpecialistIssuesPanel()';
                } else if (m.label === 'Post-Go-Live >30 Days (Not Complete)') {
                    clickHandler = 'openPostGoLive30PlusPanel()';
                }
            }
            return `
                <div class="metric-card ${m.clickable ? 'metric-card-clickable' : ''}" ${m.clickable ? `onclick="${clickHandler}"` : ''}>
                    <div class="metric-label">${m.label}</div>
                    <div class="metric-value">${m.value}</div>
                    <div class="metric-subtitle">${m.subtitle}</div>
                </div>
            `;
        }).join('');
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
        .slice(0, 50);

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
        // Attribute project to only the last specialist to avoid double-counting
        const assignedSpecialist = getAssignedSpecialist(project['OH Specialist(s)']);
        if (assignedSpecialist) {
            specialistCounts[assignedSpecialist] = (specialistCounts[assignedSpecialist] || 0) + 1;
        }
    });

    const sortedSpecialists = Object.entries(specialistCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50);

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
        // Get all specialists to populate the dropdown (for filtering purposes)
        const allSpecialists = getAllSpecialistsFromField(project['OH Specialist(s)']);
        allSpecialists.forEach(s => specialistSet.add(s));
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
            // Only count project if this specialist is the assigned specialist (last in the list)
            const assignedSpecialist = getAssignedSpecialist(project['OH Specialist(s)']);
            if (assignedSpecialist === specialist) {
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

// LOB Chart
function createLobChart() {
    destroyChart('lobChart');

    const lobCounts = {};
    filteredData.forEach(project => {
        const lob = project['LOB'];
        if (lob) {
            lobCounts[lob] = (lobCounts[lob] || 0) + 1;
        }
    });

    const ctx = document.getElementById('lobChart').getContext('2d');
    charts.lobChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(lobCounts),
            datasets: [{
                data: Object.values(lobCounts),
                backgroundColor: [
                    '#06b6d4',
                    '#8b5cf6',
                    '#ec4899',
                    '#2563eb',
                    '#10b981',
                    '#f59e0b',
                    '#ef4444',
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
            // Apply filters to data based on active filter tags
            filteredData = projectData.filter(project => {
                // If no filters are active for a category, include all projects for that category
                const regionMatch = activeFilters.region.length === 0 || activeFilters.region.includes(project['OH Region']);
                const statusMatch = activeFilters.status.length === 0 || activeFilters.status.includes(project['Project Status']);
                const typeMatch = activeFilters.type.length === 0 || activeFilters.type.includes(project['Project Type']);
                const lobMatch = activeFilters.lob.length === 0 || activeFilters.lob.includes(project['LOB']);
                const leadMatch = activeFilters.lead.length === 0 || activeFilters.lead.includes(project['OH Project Lead']);

                // For specialist filter, check if the assigned specialist (last in list) matches
                const assignedSpecialist = getAssignedSpecialist(project['OH Specialist(s)']);
                const specialistMatch = activeFilters.specialist.length === 0 ||
                                       (assignedSpecialist && activeFilters.specialist.includes(assignedSpecialist));

                return regionMatch && statusMatch && typeMatch && lobMatch && leadMatch && specialistMatch;
            });

            // Update UI components
            updateMetrics();
            renderTabContent(currentTab);
            renderTable();

        } finally {
            hideLoading();
        }
    }, 100); // 100ms debounce delay - reduced for better responsiveness
}

// Clear all filters - OPTIMIZED: Async with loading indicator
function clearFilters() {
    showLoading('Clearing filters...');

    try {
        // Clear all active filters
        activeFilters.region = [];
        activeFilters.status = [];
        activeFilters.type = [];
        activeFilters.lob = [];
        activeFilters.lead = [];
        activeFilters.specialist = [];

        // Update dropdown checkboxes
        populateFilterDropdown('regionFilterOptions', 'region', filterOptions.region);
        populateFilterDropdown('statusFilterOptions', 'status', filterOptions.status);
        populateFilterDropdown('typeFilterOptions', 'type', filterOptions.type);
        populateFilterDropdown('lobFilterOptions', 'lob', filterOptions.lob);
        populateFilterDropdown('leadFilterOptions', 'lead', filterOptions.lead);
        populateFilterDropdown('specialistFilterOptions', 'specialist', filterOptions.specialist);

        document.getElementById('searchBox').value = '';

        updateActiveFiltersDisplay();

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

    // Clear active filters
    activeFilters.region = [];
    activeFilters.status = [];
    activeFilters.type = [];
    activeFilters.lob = [];
    activeFilters.lead = [];

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

// Open No Lead Panel
function openNoLeadPanel() {
    sidePanelState = {
        isOpen: true,
        chartType: 'no-lead',
        monthIndex: 0,
        allMonths: [],
        chartData: null
    };

    document.getElementById('sidePanel').classList.add('open');
    document.getElementById('sidePanelOverlay').classList.add('open');

    updateSidePanelContent();
}

// Open Specialist Issues Panel
function openSpecialistIssuesPanel() {
    sidePanelState = {
        isOpen: true,
        chartType: 'specialist-issues',
        monthIndex: 0,
        allMonths: [],
        chartData: null
    };

    document.getElementById('sidePanel').classList.add('open');
    document.getElementById('sidePanelOverlay').classList.add('open');

    updateSidePanelContent();
}

// Open Date Sequence Errors Panel
function openDateSequenceErrorsPanel() {
    sidePanelState = {
        isOpen: true,
        chartType: 'date-sequence-errors',
        monthIndex: 0,
        allMonths: [],
        chartData: null
    };

    document.getElementById('sidePanel').classList.add('open');
    document.getElementById('sidePanelOverlay').classList.add('open');

    updateSidePanelContent();
}

// Open Post-Go-Live >30 Days Panel
function openPostGoLive30PlusPanel() {
    sidePanelState = {
        isOpen: true,
        chartType: 'post-golive-30plus',
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

    // Handle no-lead panel
    if (sidePanelState.chartType === 'no-lead') {
        document.getElementById('panelTitle').textContent = 'Projects Without Lead';
        document.querySelector('.panel-navigation').style.display = 'none';

        // Get projects without lead
        const noLeadProjects = filteredData.filter(p =>
            !p['OH Project Lead'] || p['OH Project Lead'].trim() === ''
        );

        // Update summary stats
        const summaryHTML = `
            <div class="panel-stat">
                <div class="panel-stat-label">Projects Without Lead</div>
                <div class="panel-stat-value">${noLeadProjects.length}</div>
            </div>
        `;
        document.getElementById('panelSummary').innerHTML = summaryHTML;

        // Display all projects without lead
        if (noLeadProjects.length === 0) {
            document.getElementById('panelProjects').innerHTML = `
                <div class="panel-empty">
                    <div class="panel-empty-icon">✓</div>
                    <p>All projects have an assigned lead!</p>
                </div>
            `;
        } else {
            const projectsHTML = noLeadProjects.map(project => {
                const facilityName = project['Facility Name'] || 'Unknown Facility';
                const projectShortName = project['Project Short Name'] || '';
                const specialist = project['OH Specialist(s)'] || 'Not Assigned';
                const status = project['Project Status'] || 'Unknown';
                const region = project['OH Region'] || 'Unknown';
                const projectType = project['Project Type'] || 'Unknown';
                const lob = project['LOB'] || 'Unknown';

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
                                <span class="project-info-label">Specialist:</span>
                                <span class="project-info-value">${specialist}</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            document.getElementById('panelProjects').innerHTML = projectsHTML;
        }
        return;
    }

    // Handle specialist-issues panel
    if (sidePanelState.chartType === 'specialist-issues') {
        document.getElementById('panelTitle').textContent = 'Specialist Assignment Issues';
        document.querySelector('.panel-navigation').style.display = 'none';

        // Get projects with specialist issues
        const noSpecialistsProjects = filteredData.filter(p =>
            !p['OH Specialist(s)'] || p['OH Specialist(s)'].trim() === ''
        );
        const multipleSpecialistsProjects = filteredData.filter(p => {
            const specialists = p['OH Specialist(s)'];
            return specialists && specialists.trim() !== '' &&
                   (specialists.includes(',') || specialists.includes(';'));
        });
        const allIssueProjects = [...noSpecialistsProjects, ...multipleSpecialistsProjects];

        // Update summary stats
        const summaryHTML = `
            <div class="panel-stat">
                <div class="panel-stat-label">Total Issues</div>
                <div class="panel-stat-value">${allIssueProjects.length}</div>
            </div>
            <div class="panel-stat">
                <div class="panel-stat-label">No Specialists</div>
                <div class="panel-stat-value">${noSpecialistsProjects.length}</div>
            </div>
            <div class="panel-stat">
                <div class="panel-stat-label">Multiple Specialists</div>
                <div class="panel-stat-value">${multipleSpecialistsProjects.length}</div>
            </div>
        `;
        document.getElementById('panelSummary').innerHTML = summaryHTML;

        // Display all projects with specialist issues
        if (allIssueProjects.length === 0) {
            document.getElementById('panelProjects').innerHTML = `
                <div class="panel-empty">
                    <div class="panel-empty-icon">✓</div>
                    <p>All projects have exactly one specialist assigned!</p>
                </div>
            `;
        } else {
            const projectsHTML = allIssueProjects.map(project => {
                const facilityName = project['Facility Name'] || 'Unknown Facility';
                const projectShortName = project['Project Short Name'] || '';
                const projectLead = project['OH Project Lead'] || 'Not Assigned';
                const specialist = project['OH Specialist(s)'] || 'Not Assigned';
                const status = project['Project Status'] || 'Unknown';
                const region = project['OH Region'] || 'Unknown';
                const projectType = project['Project Type'] || 'Unknown';
                const lob = project['LOB'] || 'Unknown';

                const statusClass = getStatusClass(status);

                // Determine issue type
                let issueType = '';
                if (!specialist || specialist.trim() === '') {
                    issueType = 'No Specialist Assigned';
                } else if (specialist.includes(',') || specialist.includes(';')) {
                    issueType = 'Multiple Specialists';
                }

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
                                <span class="project-info-label">Lead:</span>
                                <span class="project-info-value">${projectLead}</span>
                            </div>
                            <div class="project-info-row">
                                <span class="project-info-label">Specialist(s):</span>
                                <span class="project-info-value">${specialist}</span>
                            </div>
                        </div>
                        <div class="project-missing-dates">
                            <div class="missing-dates-label">Issue:</div>
                            <div class="missing-dates-list">
                                <span class="missing-date-badge">${issueType}</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            document.getElementById('panelProjects').innerHTML = projectsHTML;
        }
        return;
    }

    // Handle date-sequence-errors panel
    if (sidePanelState.chartType === 'date-sequence-errors') {
        document.getElementById('panelTitle').textContent = 'Projects with Date Sequence Errors';
        document.querySelector('.panel-navigation').style.display = 'none';

        // Get projects with date sequence errors
        const errorProjects = filteredData.filter(p => {
            const phaseInfo = determineProjectPhase(p);
            return phaseInfo.phase === 'dateError';
        });

        // Update summary stats
        const summaryHTML = `
            <div class="panel-stat">
                <div class="panel-stat-label">Date Sequence Errors</div>
                <div class="panel-stat-value">${errorProjects.length}</div>
            </div>
        `;
        document.getElementById('panelSummary').innerHTML = summaryHTML;

        // Display all projects with date errors
        if (errorProjects.length === 0) {
            document.getElementById('panelProjects').innerHTML = `
                <div class="panel-empty">
                    <div class="panel-empty-icon">✓</div>
                    <p>All projects have valid date sequences!</p>
                </div>
            `;
        } else {
            const projectsHTML = errorProjects.map(project => {
                const facilityName = project['Facility Name'] || 'Unknown Facility';
                const projectShortName = project['Project Short Name'] || '';
                const projectLead = project['OH Project Lead'] || 'Not Assigned';
                const specialist = project['OH Specialist(s)'] || 'Not Assigned';
                const status = project['Project Status'] || 'Unknown';
                const region = project['OH Region'] || 'Unknown';
                const projectType = project['Project Type'] || 'Unknown';
                const lob = project['LOB'] || 'Unknown';

                const kickOffDate = parseDateCached(project['Kick-Off Date'], project.__id);
                const testStartDate = parseDateCached(project['Testing Start'], project.__id);
                const testEndDate = parseDateCached(project['Testing End'], project.__id);
                const goLiveDate = parseDateCached(project['OH Go-Live Date'], project.__id);

                const statusClass = getStatusClass(status);

                // Get error details
                const phaseInfo = determineProjectPhase(project);
                const errorMessage = phaseInfo.error || 'Unknown error';

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
                                <span class="project-info-label">Lead:</span>
                                <span class="project-info-value">${projectLead}</span>
                            </div>
                            <div class="project-info-row">
                                <span class="project-info-label">Specialist:</span>
                                <span class="project-info-value">${specialist}</span>
                            </div>
                        </div>
                        <div class="project-missing-dates">
                            <div class="missing-dates-label">Date Sequence Error:</div>
                            <div class="missing-dates-list">
                                <span class="missing-date-badge" style="background: #fee2e2; color: #991b1b;">${errorMessage}</span>
                            </div>
                            <div style="margin-top: 0.75rem; font-size: 0.875rem; color: var(--text-secondary);">
                                ${kickOffDate ? `<div>Kick-Off: ${formatDate(kickOffDate)}</div>` : '<div>Kick-Off: Missing</div>'}
                                ${testStartDate ? `<div>Testing Start: ${formatDate(testStartDate)}</div>` : '<div>Testing Start: Missing</div>'}
                                ${testEndDate ? `<div>Testing End: ${formatDate(testEndDate)}</div>` : '<div>Testing End: Missing</div>'}
                                ${goLiveDate ? `<div>Go-Live: ${formatDate(goLiveDate)}</div>` : '<div>Go-Live: Missing</div>'}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            document.getElementById('panelProjects').innerHTML = projectsHTML;
        }
        return;
    }

    // Handle post-golive-30plus panel
    if (sidePanelState.chartType === 'post-golive-30plus') {
        document.getElementById('panelTitle').textContent = 'Post-Go-Live >30 Days (Not Complete)';
        document.querySelector('.panel-navigation').style.display = 'none';

        // Get projects that are >30 days post-go-live with non-complete status
        const postGoLive30PlusProjects = filteredData.filter(p => {
            const phaseInfo = determineProjectPhase(p);
            if (phaseInfo.phase !== 'postGoLive30Plus') return false;

            const status = p['Project Status'];
            return status && !status.toLowerCase().includes('complete');
        });

        // Update summary stats
        const summaryHTML = `
            <div class="panel-stat">
                <div class="panel-stat-label">Total Projects</div>
                <div class="panel-stat-value">${postGoLive30PlusProjects.length}</div>
            </div>
        `;
        document.getElementById('panelSummary').innerHTML = summaryHTML;

        // Display all projects
        if (postGoLive30PlusProjects.length === 0) {
            document.getElementById('panelProjects').innerHTML = `
                <div class="panel-empty">
                    <div class="panel-empty-icon">✓</div>
                    <p>No projects are >30 days post-go-live with incomplete status!</p>
                </div>
            `;
        } else {
            const projectsHTML = postGoLive30PlusProjects.map(project => {
                const facilityName = project['Facility Name'] || 'Unknown Facility';
                const projectShortName = project['Project Short Name'] || '';
                const projectLead = project['OH Project Lead'] || 'Not Assigned';
                const specialist = project['OH Specialist(s)'] || 'Not Assigned';
                const status = project['Project Status'] || 'Unknown';
                const region = project['OH Region'] || 'Unknown';
                const projectType = project['Project Type'] || 'Unknown';
                const lob = project['LOB'] || 'Unknown';

                const goLiveDate = parseDateCached(project['OH Go-Live Date'], project.__id);
                const statusClass = getStatusClass(status);

                // Calculate days since go-live
                const now = new Date();
                const daysSinceGoLive = goLiveDate ? Math.floor((now - goLiveDate) / (1000 * 60 * 60 * 24)) : 0;

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
                                <span class="project-info-label">Lead:</span>
                                <span class="project-info-value">${projectLead}</span>
                            </div>
                            <div class="project-info-row">
                                <span class="project-info-label">Specialist:</span>
                                <span class="project-info-value">${specialist}</span>
                            </div>
                        </div>
                        <div class="project-missing-dates">
                            <div class="missing-dates-label">Go-Live Information:</div>
                            <div style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--text-secondary);">
                                ${goLiveDate ? `
                                    <div>Go-Live Date: ${formatDate(goLiveDate)}</div>
                                    <div style="margin-top: 0.25rem; color: var(--warning-color); font-weight: 500;">
                                        ${daysSinceGoLive} days since go-live
                                    </div>
                                ` : '<div>Go-Live: Missing</div>'}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            document.getElementById('panelProjects').innerHTML = projectsHTML;
        }
        return;
    }

    // Handle person projects panel
    if (sidePanelState.chartType === 'person-projects') {
        const { person, role, projects } = sidePanelState;
        document.getElementById('panelTitle').textContent = `${person}'s Active Projects`;
        document.querySelector('.panel-navigation').style.display = 'none';

        // Calculate phase breakdown
        const phaseBreakdown = {
            preKickoff30Plus: 0, preKickoff0to30: 0, activePreTesting: 0,
            activeTesting: 0, activePostTesting: 0, postGoLive0to30: 0,
            postGoLive30Plus: 0, unknown: 0, dateError: 0, closed: 0
        };

        projects.forEach(project => {
            const phaseInfo = determineProjectPhase(project);
            if (phaseBreakdown[phaseInfo.phase] !== undefined) {
                phaseBreakdown[phaseInfo.phase]++;
            }
        });

        // Filter out closed projects for the display
        const activeProjectsList = projects.filter(p => {
            const phaseInfo = determineProjectPhase(p);
            return phaseInfo.phase !== 'closed';
        });

        // Update summary stats
        const summaryHTML = `
            <div class="panel-stat">
                <div class="panel-stat-label">Total Active Projects</div>
                <div class="panel-stat-value">${activeProjectsList.length}</div>
            </div>
            <div class="panel-stat">
                <div class="panel-stat-label">Role</div>
                <div class="panel-stat-value">${role}</div>
            </div>
            ${phaseBreakdown.preKickoff30Plus + phaseBreakdown.preKickoff0to30 > 0 ? `
                <div class="panel-stat">
                    <div class="panel-stat-label">Pre-Kickoff</div>
                    <div class="panel-stat-value">${phaseBreakdown.preKickoff30Plus + phaseBreakdown.preKickoff0to30}</div>
                </div>
            ` : ''}
            ${phaseBreakdown.activePreTesting + phaseBreakdown.activeTesting + phaseBreakdown.activePostTesting > 0 ? `
                <div class="panel-stat">
                    <div class="panel-stat-label">Active Phase</div>
                    <div class="panel-stat-value">${phaseBreakdown.activePreTesting + phaseBreakdown.activeTesting + phaseBreakdown.activePostTesting}</div>
                </div>
            ` : ''}
            ${phaseBreakdown.postGoLive0to30 + phaseBreakdown.postGoLive30Plus > 0 ? `
                <div class="panel-stat">
                    <div class="panel-stat-label">Post-Go-Live</div>
                    <div class="panel-stat-value">${phaseBreakdown.postGoLive0to30 + phaseBreakdown.postGoLive30Plus}</div>
                </div>
            ` : ''}
        `;
        document.getElementById('panelSummary').innerHTML = summaryHTML;

        // Display all active projects
        if (activeProjectsList.length === 0) {
            document.getElementById('panelProjects').innerHTML = `
                <div class="panel-empty">
                    <div class="panel-empty-icon">✓</div>
                    <p>No active projects found for ${person}</p>
                </div>
            `;
        } else {
            const projectsHTML = activeProjectsList.map(project => {
                const facilityName = project['Facility Name'] || 'Unknown Facility';
                const projectShortName = project['Project Short Name'] || '';
                const projectLead = project['OH Project Lead'] || 'Not Assigned';
                const specialist = project['OH Specialist(s)'] || 'Not Assigned';
                const status = project['Project Status'] || 'Unknown';
                const region = project['OH Region'] || 'Unknown';
                const projectType = project['Project Type'] || 'Unknown';
                const lob = project['LOB'] || 'Unknown';

                const kickOffDate = parseDateCached(project['Kick-Off Date'], project.__id);
                const testStartDate = parseDateCached(project['Testing Start'], project.__id);
                const testEndDate = parseDateCached(project['Testing End'], project.__id);
                const goLiveDate = parseDateCached(project['OH Go-Live Date'], project.__id);

                const statusClass = getStatusClass(status);

                // Get phase info
                const phaseInfo = determineProjectPhase(project);

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
                                <span class="project-info-label">Lead:</span>
                                <span class="project-info-value">${projectLead}</span>
                            </div>
                            <div class="project-info-row">
                                <span class="project-info-label">Specialist:</span>
                                <span class="project-info-value">${specialist}</span>
                            </div>
                            <div class="project-info-row">
                                <span class="project-info-label">Phase:</span>
                                <span class="project-info-value" style="font-weight: 600; color: ${phaseInfo.phase === 'unknown' || phaseInfo.phase === 'dateError' ? 'var(--warning-color)' : 'var(--primary-color)'};">${phaseInfo.phaseName}</span>
                            </div>
                        </div>
                        <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--border); font-size: 0.875rem;">
                            ${kickOffDate ? `<div style="margin-bottom: 0.25rem;">Kick-Off: <strong>${formatDate(kickOffDate)}</strong></div>` : ''}
                            ${testStartDate ? `<div style="margin-bottom: 0.25rem;">Testing Start: <strong>${formatDate(testStartDate)}</strong></div>` : ''}
                            ${testEndDate ? `<div style="margin-bottom: 0.25rem;">Testing End: <strong>${formatDate(testEndDate)}</strong></div>` : ''}
                            ${goLiveDate ? `<div>Go-Live: <strong>${formatDate(goLiveDate)}</strong></div>` : ''}
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
            // Only include project if the assigned specialist (last in list) is selected
            const assignedSpecialist = getAssignedSpecialist(p['OH Specialist(s)']);
            const hasSelectedSpecialist = assignedSpecialist && selectedSpecialists.includes(assignedSpecialist);

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

// ==================== CAPACITY PLANNING FUNCTIONS ====================

// Load capacity configuration from localStorage
function loadCapacityConfig() {
    const saved = localStorage.getItem('capacityConfig');
    if (saved) {
        try {
            const savedConfig = JSON.parse(saved);
            // Merge saved config with defaults (in case new fields were added)
            capacityConfig = {
                ...capacityConfig,
                ...savedConfig,
                phaseWeights: {
                    lead: {
                        ...capacityConfig.phaseWeights.lead,
                        ...(savedConfig.phaseWeights?.lead || {})
                    },
                    specialist: {
                        ...capacityConfig.phaseWeights.specialist,
                        ...(savedConfig.phaseWeights?.specialist || {})
                    }
                }
            };
        } catch (e) {
            console.error('Error loading capacity config:', e);
        }
    }

    // Update UI inputs if they exist
    const leadInput = document.getElementById('defaultLeadCapacity');
    const specialistInput = document.getElementById('defaultSpecialistCapacity');
    const thresholdInput = document.getElementById('alertThreshold');

    if (leadInput) leadInput.value = capacityConfig.defaultLeadCapacity;
    if (specialistInput) specialistInput.value = capacityConfig.defaultSpecialistCapacity;
    if (thresholdInput) thresholdInput.value = capacityConfig.alertThreshold;

    // Load phase weight inputs
    const phaseInputs = {
        lead: {
            preKickoff30Plus: document.getElementById('leadPreKickoff30Plus'),
            preKickoff0to30: document.getElementById('leadPreKickoff0to30'),
            activePreTesting: document.getElementById('leadActivePreTesting'),
            activeTesting: document.getElementById('leadActiveTesting'),
            activePostTesting: document.getElementById('leadActivePostTesting'),
            postGoLive0to30: document.getElementById('leadPostGoLive0to30'),
            postGoLive30Plus: document.getElementById('leadPostGoLive30Plus')
        },
        specialist: {
            preKickoff30Plus: document.getElementById('specialistPreKickoff30Plus'),
            preKickoff0to30: document.getElementById('specialistPreKickoff0to30'),
            activePreTesting: document.getElementById('specialistActivePreTesting'),
            activeTesting: document.getElementById('specialistActiveTesting'),
            activePostTesting: document.getElementById('specialistActivePostTesting'),
            postGoLive0to30: document.getElementById('specialistPostGoLive0to30'),
            postGoLive30Plus: document.getElementById('specialistPostGoLive30Plus')
        }
    };

    Object.keys(phaseInputs.lead).forEach(phase => {
        if (phaseInputs.lead[phase]) {
            phaseInputs.lead[phase].value = capacityConfig.phaseWeights.lead[phase];
        }
    });

    Object.keys(phaseInputs.specialist).forEach(phase => {
        if (phaseInputs.specialist[phase]) {
            phaseInputs.specialist[phase].value = capacityConfig.phaseWeights.specialist[phase];
        }
    });

    renderCapacityOverrides();
}

// Save capacity configuration to localStorage
function saveCapacityConfig() {
    capacityConfig.defaultLeadCapacity = parseInt(document.getElementById('defaultLeadCapacity').value);
    capacityConfig.defaultSpecialistCapacity = parseInt(document.getElementById('defaultSpecialistCapacity').value);
    capacityConfig.alertThreshold = parseInt(document.getElementById('alertThreshold').value);

    // Save phase weights
    const phaseFields = ['preKickoff30Plus', 'preKickoff0to30', 'activePreTesting', 'activeTesting',
                         'activePostTesting', 'postGoLive0to30', 'postGoLive30Plus'];

    phaseFields.forEach(phase => {
        const leadInput = document.getElementById(`lead${phase.charAt(0).toUpperCase() + phase.slice(1)}`);
        const specialistInput = document.getElementById(`specialist${phase.charAt(0).toUpperCase() + phase.slice(1)}`);

        if (leadInput) {
            capacityConfig.phaseWeights.lead[phase] = parseInt(leadInput.value) || 0;
        }
        if (specialistInput) {
            capacityConfig.phaseWeights.specialist[phase] = parseInt(specialistInput.value) || 0;
        }
    });

    localStorage.setItem('capacityConfig', JSON.stringify(capacityConfig));

    // Re-render capacity planning if on that tab
    if (currentTab === 'capacity-planning') {
        renderCapacityPlanning();
    }
}

// Toggle capacity configuration panel
function toggleCapacityConfig() {
    const panel = document.getElementById('capacityConfigPanel');
    const toggleText = document.getElementById('configToggleText');

    if (panel.style.display === 'none') {
        panel.style.display = 'block';
        toggleText.textContent = 'Hide Settings';
    } else {
        panel.style.display = 'none';
        toggleText.textContent = 'Show Settings';
    }
}

// Show modal for adding capacity override
function showAddOverrideModal() {
    const modal = document.getElementById('addOverrideModal');
    const select = document.getElementById('overridePersonSelect');

    // Populate select with all leads and specialists
    const allPeople = new Set();
    filteredData.forEach(p => {
        if (p['OH Project Lead']) allPeople.add(p['OH Project Lead']);
        // Get all unique specialists (not just the assigned one)
        const allSpecialists = getAllSpecialistsFromField(p['OH Specialist(s)']);
        allSpecialists.forEach(s => allPeople.add(s));
    });

    select.innerHTML = '<option value="">-- Select Person --</option>' +
        [...allPeople].sort().map(person => `<option value="${person}">${person}</option>`).join('');

    document.getElementById('overrideCapacityInput').value = 4;
    document.getElementById('overrideReasonInput').value = '';

    modal.classList.add('open');
}

// Close add override modal
function closeAddOverrideModal() {
    document.getElementById('addOverrideModal').classList.remove('open');
}

// Add capacity override
function addCapacityOverride() {
    const person = document.getElementById('overridePersonSelect').value;
    const capacity = parseInt(document.getElementById('overrideCapacityInput').value);
    const reason = document.getElementById('overrideReasonInput').value;

    if (!person) {
        alert('Please select a person');
        return;
    }

    capacityConfig.individualOverrides[person] = {
        capacity,
        reason: reason || null
    };

    saveCapacityConfig();
    renderCapacityOverrides();
    closeAddOverrideModal();

    // Re-render capacity planning
    if (currentTab === 'capacity-planning') {
        renderCapacityPlanning();
    }
}

// Remove capacity override
function removeCapacityOverride(person) {
    delete capacityConfig.individualOverrides[person];
    saveCapacityConfig();
    renderCapacityOverrides();

    // Re-render capacity planning
    if (currentTab === 'capacity-planning') {
        renderCapacityPlanning();
    }
}

// Render capacity overrides list
function renderCapacityOverrides() {
    const container = document.getElementById('individualOverrides');
    if (!container) return;

    const overrides = Object.entries(capacityConfig.individualOverrides);

    if (overrides.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); font-size: 0.875rem; font-style: italic;">No overrides configured</p>';
        return;
    }

    container.innerHTML = overrides.map(([person, config]) => `
        <div class="override-item">
            <div class="override-info">
                <span class="override-name">${person}</span>
                <span class="override-capacity">${config.capacity} projects</span>
                ${config.reason ? `<span class="override-reason">(${config.reason})</span>` : ''}
            </div>
            <button class="btn-remove-override" onclick="removeCapacityOverride('${person.replace(/'/g, "\\'")}')">Remove</button>
        </div>
    `).join('');
}

// Calculate resource capacity for a person
function calculateResourceCapacity(person, role) {
    const now = new Date();

    // Get all projects for this person (not just active, to see all phases)
    const personProjects = filteredData.filter(p => {
        const isLead = p['OH Project Lead'] === person;
        const assignedSpecialist = getAssignedSpecialist(p['OH Specialist(s)']);
        const isSpecialist = assignedSpecialist === person;

        return (isLead || isSpecialist);
    });

    // Initialize phase breakdown
    const phaseBreakdown = {
        preKickoff30Plus: [],
        preKickoff0to30: [],
        activePreTesting: [],
        activeTesting: [],
        activePostTesting: [],
        postGoLive0to30: [],
        postGoLive30Plus: [],
        unknown: [],
        dateError: [],
        closed: []
    };

    // Categorize projects by phase and calculate weighted capacity
    let weightedCapacity = 0;
    const weights = role === 'Lead' ? capacityConfig.phaseWeights.lead : capacityConfig.phaseWeights.specialist;

    personProjects.forEach(project => {
        const phaseInfo = determineProjectPhase(project);
        const phase = phaseInfo.phase;

        // Add project to phase breakdown
        if (phaseBreakdown[phase] !== undefined) {
            phaseBreakdown[phase].push(project);
        }

        // Add weighted capacity (only for valid phases, not closed/error/unknown)
        if (weights[phase] !== undefined) {
            weightedCapacity += weights[phase] / 100; // Convert percentage to decimal
        }
    });

    // Count projects in each phase
    const phaseCounts = {
        preKickoff30Plus: phaseBreakdown.preKickoff30Plus.length,
        preKickoff0to30: phaseBreakdown.preKickoff0to30.length,
        activePreTesting: phaseBreakdown.activePreTesting.length,
        activeTesting: phaseBreakdown.activeTesting.length,
        activePostTesting: phaseBreakdown.activePostTesting.length,
        postGoLive0to30: phaseBreakdown.postGoLive0to30.length,
        postGoLive30Plus: phaseBreakdown.postGoLive30Plus.length,
        unknown: phaseBreakdown.unknown.length,
        dateError: phaseBreakdown.dateError.length,
        closed: phaseBreakdown.closed.length
    };

    // Determine max capacity
    let maxCapacity;
    if (capacityConfig.individualOverrides[person]) {
        maxCapacity = capacityConfig.individualOverrides[person].capacity;
    } else if (role === 'Lead') {
        maxCapacity = capacityConfig.defaultLeadCapacity;
    } else {
        maxCapacity = capacityConfig.defaultSpecialistCapacity;
    }

    const utilization = maxCapacity > 0 ? (weightedCapacity / maxCapacity) * 100 : 0;
    const alertThreshold = capacityConfig.alertThreshold;

    // Determine status
    let status, statusClass;
    if (utilization >= 100) {
        status = 'Critical';
        statusClass = 'critical';
    } else if (utilization >= alertThreshold) {
        status = 'High Load';
        statusClass = 'warning';
    } else if (utilization >= 50) {
        status = 'Normal';
        statusClass = 'normal';
    } else {
        status = 'Available';
        statusClass = 'available';
    }

    // Calculate next available date (earliest project go-live from active phases)
    let nextAvailable = null;
    if (weightedCapacity >= maxCapacity) {
        const activeProjects = [
            ...phaseBreakdown.activePreTesting,
            ...phaseBreakdown.activeTesting,
            ...phaseBreakdown.activePostTesting
        ];
        const endDates = activeProjects.map(p => parseDateCached(p['OH Go-Live Date'], p.__id)).filter(d => d);
        if (endDates.length > 0) {
            nextAvailable = new Date(Math.min(...endDates));
        }
    }

    // Total project count (excluding closed)
    const totalProjects = personProjects.length - phaseBreakdown.closed.length;

    return {
        person,
        role,
        totalProjects,
        currentProjects: totalProjects, // For backwards compatibility
        weightedCapacity: Math.round(weightedCapacity * 10) / 10, // Round to 1 decimal
        maxCapacity,
        utilization: Math.round(utilization),
        status,
        statusClass,
        nextAvailable,
        projects: personProjects,
        phaseBreakdown,
        phaseCounts,
        availableCapacity: Math.max(0, maxCapacity - weightedCapacity)
    };
}

// Main render function for capacity planning tab
function renderCapacityPlanning() {
    renderCapacityMetrics();
    renderCapacityCards();
    createLeadsPhaseChart();
    createSpecialistsPhaseChart();
}

// Render capacity metrics
function renderCapacityMetrics() {
    const metricsGrid = document.getElementById('capacityMetricsGrid');
    if (!metricsGrid) return;

    // Calculate all resource capacities
    const leads = [...new Set(filteredData.map(p => p['OH Project Lead']).filter(l => l))];

    // Get all unique specialists (from all fields, not just assigned ones)
    const specialistSet = new Set();
    filteredData.forEach(p => {
        const allSpecialists = getAllSpecialistsFromField(p['OH Specialist(s)']);
        allSpecialists.forEach(s => specialistSet.add(s));
    });
    const specialists = [...specialistSet];

    const leadCapacities = leads.map(lead => calculateResourceCapacity(lead, 'Lead'));
    const specialistCapacities = specialists.map(spec => calculateResourceCapacity(spec, 'Specialist'));

    const allCapacities = [...leadCapacities, ...specialistCapacities];

    // Calculate metrics
    const overallocated = allCapacities.filter(c => c.utilization >= 100).length;
    const highLoad = allCapacities.filter(c => c.utilization >= capacityConfig.alertThreshold && c.utilization < 100).length;
    const available = allCapacities.filter(c => c.utilization < 50).length;
    const avgUtilization = allCapacities.length > 0
        ? Math.round(allCapacities.reduce((sum, c) => sum + c.utilization, 0) / allCapacities.length)
        : 0;

    const metrics = [
        { label: 'Total Resources', value: allCapacities.length, subtitle: `${leads.length} Leads, ${specialists.length} Specialists`, clickable: false },
        { label: 'Overallocated', value: overallocated, subtitle: 'At or above 100% capacity', clickable: false, color: 'danger' },
        { label: 'High Load', value: highLoad, subtitle: `${capacityConfig.alertThreshold}% or higher capacity`, clickable: false, color: 'warning' },
        { label: 'Available', value: available, subtitle: 'Below 50% capacity', clickable: false, color: 'success' },
        { label: 'Avg Utilization', value: `${avgUtilization}%`, subtitle: 'Across all resources', clickable: false }
    ];

    metricsGrid.innerHTML = metrics.map(m => `
        <div class="metric-card ${m.clickable ? 'metric-card-clickable' : ''}">
            <div class="metric-label">${m.label}</div>
            <div class="metric-value" style="${m.color ? `color: var(--${m.color}-color)` : ''}">${m.value}</div>
            <div class="metric-subtitle">${m.subtitle}</div>
        </div>
    `).join('');
}

// Render capacity cards
function renderCapacityCards() {
    const container = document.getElementById('resourceCapacityCards');
    if (!container) return;

    // Calculate all resource capacities
    const leads = [...new Set(filteredData.map(p => p['OH Project Lead']).filter(l => l))];

    // Get all unique specialists (from all fields, not just assigned ones)
    const specialistSet = new Set();
    filteredData.forEach(p => {
        const allSpecialists = getAllSpecialistsFromField(p['OH Specialist(s)']);
        allSpecialists.forEach(s => specialistSet.add(s));
    });
    const specialists = [...specialistSet];

    const leadCapacities = leads.map(lead => calculateResourceCapacity(lead, 'Lead'));
    const specialistCapacities = specialists.map(spec => calculateResourceCapacity(spec, 'Specialist'));

    let allCapacities = [...leadCapacities, ...specialistCapacities];

    // Apply filter
    if (currentCapacityFilter === 'leads') {
        allCapacities = leadCapacities;
    } else if (currentCapacityFilter === 'specialists') {
        allCapacities = specialistCapacities;
    } else if (currentCapacityFilter === 'overallocated') {
        allCapacities = allCapacities.filter(c => c.utilization >= capacityConfig.alertThreshold);
    } else if (currentCapacityFilter === 'available') {
        allCapacities = allCapacities.filter(c => c.utilization < 70);
    }

    // Sort by utilization (highest first)
    allCapacities.sort((a, b) => b.utilization - a.utilization);

    if (allCapacities.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">No resources match the current filter</p>';
        return;
    }

    container.innerHTML = allCapacities.map(capacity => {
        const cardId = `${capacity.person}-${capacity.role}`.replace(/\s+/g, '-');
        const isExpanded = expandedCapacityCards.has(cardId);

        return `
        <div class="resource-capacity-card ${isExpanded ? 'expanded' : ''}" data-card-id="${cardId}">
            <div class="resource-card-header" onclick="toggleCapacityCard('${cardId}')">
                <div>
                    <div class="resource-name">${capacity.person}</div>
                    <div class="resource-role">${capacity.role}</div>
                </div>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span class="capacity-status-badge ${capacity.statusClass}">${capacity.status}</span>
                    <span class="expand-icon">${isExpanded ? '▼' : '▶'}</span>
                </div>
            </div>
            <div class="capacity-progress-bar">
                <div class="capacity-progress-fill ${capacity.statusClass}" style="width: ${Math.min(100, capacity.utilization)}%">
                    ${capacity.utilization}%
                </div>
            </div>
            <div class="capacity-details">
                <div class="capacity-detail-item">
                    <span class="capacity-detail-label">Weighted Capacity</span>
                    <span class="capacity-detail-value">${capacity.weightedCapacity}/${capacity.maxCapacity}</span>
                </div>
                <div class="capacity-detail-item">
                    <span class="capacity-detail-label">Total Projects</span>
                    <span class="capacity-detail-value">${capacity.totalProjects}</span>
                </div>
            </div>
            ${capacity.nextAvailable ? `
                <div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--border);">
                    <span style="font-size: 0.75rem; color: var(--text-secondary);">Next available: </span>
                    <span style="font-size: 0.875rem; font-weight: 600; color: var(--text-primary);">${formatDate(capacity.nextAvailable)}</span>
                </div>
            ` : ''}
            <div class="capacity-expandable-section" style="display: ${isExpanded ? 'block' : 'none'};">
                ${capacity.phaseCounts && (capacity.phaseCounts.preKickoff30Plus > 0 || capacity.phaseCounts.preKickoff0to30 > 0 ||
                   capacity.phaseCounts.activePreTesting > 0 || capacity.phaseCounts.activeTesting > 0 ||
                   capacity.phaseCounts.activePostTesting > 0 || capacity.phaseCounts.postGoLive0to30 > 0 ||
                   capacity.phaseCounts.postGoLive30Plus > 0 || capacity.phaseCounts.unknown > 0) ? `
                    <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border);">
                        <h4 style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.5px;">Phase Breakdown:</h4>
                        <div style="display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.75rem;">
                            ${capacity.phaseCounts.preKickoff30Plus > 0 ? `<div style="color: var(--text-primary);">• Pre-Kickoff (>30d): <strong>${capacity.phaseCounts.preKickoff30Plus}</strong> (${Math.round(capacity.phaseCounts.preKickoff30Plus * (capacity.role === 'Lead' ? capacityConfig.phaseWeights.lead.preKickoff30Plus : capacityConfig.phaseWeights.specialist.preKickoff30Plus) / 100 * 10) / 10})</div>` : ''}
                            ${capacity.phaseCounts.preKickoff0to30 > 0 ? `<div style="color: var(--text-primary);">• Pre-Kickoff (0-30d): <strong>${capacity.phaseCounts.preKickoff0to30}</strong> (${Math.round(capacity.phaseCounts.preKickoff0to30 * (capacity.role === 'Lead' ? capacityConfig.phaseWeights.lead.preKickoff0to30 : capacityConfig.phaseWeights.specialist.preKickoff0to30) / 100 * 10) / 10})</div>` : ''}
                            ${capacity.phaseCounts.activePreTesting > 0 ? `<div style="color: var(--text-primary);">• Active Pre-Testing: <strong>${capacity.phaseCounts.activePreTesting}</strong> (${Math.round(capacity.phaseCounts.activePreTesting * (capacity.role === 'Lead' ? capacityConfig.phaseWeights.lead.activePreTesting : capacityConfig.phaseWeights.specialist.activePreTesting) / 100 * 10) / 10})</div>` : ''}
                            ${capacity.phaseCounts.activeTesting > 0 ? `<div style="color: var(--text-primary);">• Active Testing: <strong>${capacity.phaseCounts.activeTesting}</strong> (${Math.round(capacity.phaseCounts.activeTesting * (capacity.role === 'Lead' ? capacityConfig.phaseWeights.lead.activeTesting : capacityConfig.phaseWeights.specialist.activeTesting) / 100 * 10) / 10})</div>` : ''}
                            ${capacity.phaseCounts.activePostTesting > 0 ? `<div style="color: var(--text-primary);">• Active Post-Testing: <strong>${capacity.phaseCounts.activePostTesting}</strong> (${Math.round(capacity.phaseCounts.activePostTesting * (capacity.role === 'Lead' ? capacityConfig.phaseWeights.lead.activePostTesting : capacityConfig.phaseWeights.specialist.activePostTesting) / 100 * 10) / 10})</div>` : ''}
                            ${capacity.phaseCounts.postGoLive0to30 > 0 ? `<div style="color: var(--text-primary);">• Post-Go-Live (0-30d): <strong>${capacity.phaseCounts.postGoLive0to30}</strong> (${Math.round(capacity.phaseCounts.postGoLive0to30 * (capacity.role === 'Lead' ? capacityConfig.phaseWeights.lead.postGoLive0to30 : capacityConfig.phaseWeights.specialist.postGoLive0to30) / 100 * 10) / 10})</div>` : ''}
                            ${capacity.phaseCounts.postGoLive30Plus > 0 ? `<div style="color: var(--text-primary);">• Post-Go-Live (>30d): <strong>${capacity.phaseCounts.postGoLive30Plus}</strong> (${Math.round(capacity.phaseCounts.postGoLive30Plus * (capacity.role === 'Lead' ? capacityConfig.phaseWeights.lead.postGoLive30Plus : capacityConfig.phaseWeights.specialist.postGoLive30Plus) / 100 * 10) / 10})</div>` : ''}
                            ${capacity.phaseCounts.unknown > 0 ? `<div style="color: var(--warning-color);">• Unknown Phase: <strong>${capacity.phaseCounts.unknown}</strong></div>` : ''}
                        </div>
                    </div>
                ` : ''}
                ${capacity.projects.length > 0 ? `
                    <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border); text-align: center;">
                        <button class="btn-view-projects" onclick="openPersonProjectsPanel('${capacity.person.replace(/'/g, "\\'")}', '${capacity.role}', ${JSON.stringify(capacity.projects.map(p => p.__id))})">
                            View Active Projects (${capacity.totalProjects})
                        </button>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
    }).join('');
}

// Toggle capacity card expansion
function toggleCapacityCard(cardId) {
    if (expandedCapacityCards.has(cardId)) {
        expandedCapacityCards.delete(cardId);
    } else {
        expandedCapacityCards.add(cardId);
    }
    renderCapacityCards();
}

// Open side panel to show person's active projects
function openPersonProjectsPanel(person, role, projectIds) {
    // Find the actual project objects from the IDs
    const projects = filteredData.filter(p => projectIds.includes(p.__id));

    sidePanelState = {
        isOpen: true,
        chartType: 'person-projects',
        person: person,
        role: role,
        projects: projects
    };

    document.getElementById('sidePanel').classList.add('open');
    updateSidePanelContent();
}

// Filter capacity view
function filterCapacityView(filter) {
    currentCapacityFilter = filter;

    // Update button states
    document.querySelectorAll('.capacity-filter-btn').forEach(btn => {
        if (btn.getAttribute('data-filter') === filter) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    renderCapacityCards();
}

// Create capacity utilization chart
function createCapacityUtilizationChart() {
    destroyChart('capacityUtilizationChart');

    // Calculate all resource capacities
    const leads = [...new Set(filteredData.map(p => p['OH Project Lead']).filter(l => l))];

    // Get all unique specialists (from all fields, not just assigned ones)
    const specialistSet = new Set();
    filteredData.forEach(p => {
        const allSpecialists = getAllSpecialistsFromField(p['OH Specialist(s)']);
        allSpecialists.forEach(s => specialistSet.add(s));
    });
    const specialists = [...specialistSet];

    const allPeople = [...leads, ...specialists];
    const capacities = allPeople.map(person => {
        const role = leads.includes(person) ? 'Lead' : 'Specialist';
        return calculateResourceCapacity(person, role);
    });

    // Sort by utilization
    capacities.sort((a, b) => b.utilization - a.utilization);

    // Take top 20 for readability
    const topCapacities = capacities.slice(0, 20);

    const ctx = document.getElementById('capacityUtilizationChart');
    if (!ctx) return;

    charts.capacityUtilizationChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: topCapacities.map(c => c.person),
            datasets: [{
                label: 'Capacity Utilization (%)',
                data: topCapacities.map(c => c.utilization),
                backgroundColor: topCapacities.map(c => {
                    if (c.utilization >= 100) return 'rgba(239, 68, 68, 0.8)';
                    if (c.utilization >= capacityConfig.alertThreshold) return 'rgba(245, 158, 11, 0.8)';
                    if (c.utilization >= 50) return 'rgba(37, 99, 235, 0.8)';
                    return 'rgba(16, 185, 129, 0.8)';
                }),
                borderColor: topCapacities.map(c => {
                    if (c.utilization >= 100) return 'rgb(239, 68, 68)';
                    if (c.utilization >= capacityConfig.alertThreshold) return 'rgb(245, 158, 11)';
                    if (c.utilization >= 50) return 'rgb(37, 99, 235)';
                    return 'rgb(16, 185, 129)';
                }),
                borderWidth: 2
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const capacity = topCapacities[context.dataIndex];
                            return [
                                `Utilization: ${capacity.utilization}%`,
                                `Current: ${capacity.currentProjects}/${capacity.maxCapacity} projects`,
                                `Status: ${capacity.status}`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    max: 120,
                    title: {
                        display: true,
                        text: 'Capacity Utilization (%)'
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                },
                y: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

// Create leads phase distribution chart
function createLeadsPhaseChart() {
    destroyChart('leadsPhaseChart');

    const leads = [...new Set(filteredData.map(p => p['OH Project Lead']).filter(l => l))];
    const capacities = leads.map(person => calculateResourceCapacity(person, 'Lead'));

    // Sort by total project count descending
    capacities.sort((a, b) => b.totalProjects - a.totalProjects);

    const ctx = document.getElementById('leadsPhaseChart');
    if (!ctx) return;

    // Phase labels and colors
    const phases = [
        { key: 'preKickoff30Plus', label: 'Pre-Kickoff (>30d)', color: '#e0f2fe' },
        { key: 'preKickoff0to30', label: 'Pre-Kickoff (0-30d)', color: '#7dd3fc' },
        { key: 'activePreTesting', label: 'Active Pre-Testing', color: '#2563eb' },
        { key: 'activeTesting', label: 'Active Testing', color: '#1e40af' },
        { key: 'activePostTesting', label: 'Active Post-Testing', color: '#8b5cf6' },
        { key: 'postGoLive0to30', label: 'Post-Go-Live (0-30d)', color: '#a78bfa' },
        { key: 'postGoLive30Plus', label: 'Post-Go-Live (>30d)', color: '#e9d5ff' },
        { key: 'unknown', label: 'Unknown Phase', color: '#d1d5db' }
    ];

    // Create datasets for each phase
    const datasets = phases.map(phase => ({
        label: phase.label,
        data: capacities.map(c => c.phaseCounts[phase.key] || 0),
        backgroundColor: phase.color,
        stack: 'Stack 0'
    }));

    // Calculate max value for capacity zone lines
    const maxProjects = Math.max(...capacities.map(c => c.totalProjects), 10);
    const defaultCapacity = capacityConfig.defaultLeadCapacity;

    charts.leadsPhaseChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: capacities.map(c => c.person),
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.parsed.y} projects`;
                        },
                        footer: function(tooltipItems) {
                            const capacity = capacities[tooltipItems[0].dataIndex];
                            return [
                                `Total: ${capacity.totalProjects} projects`,
                                `Weighted: ${capacity.weightedCapacity} / ${capacity.maxCapacity}`,
                                `Utilization: ${capacity.utilization}%`
                            ];
                        }
                    }
                },
                annotation: {
                    annotations: {
                        criticalLine: {
                            type: 'line',
                            yMin: defaultCapacity,
                            yMax: defaultCapacity,
                            borderColor: 'rgba(239, 68, 68, 0.3)',
                            borderWidth: 2,
                            borderDash: [5, 5],
                            label: {
                                display: true,
                                content: `Capacity: ${defaultCapacity}`,
                                position: 'end'
                            }
                        },
                        criticalZone: {
                            type: 'box',
                            yMin: defaultCapacity,
                            yMax: maxProjects + 2,
                            backgroundColor: 'rgba(239, 68, 68, 0.05)',
                            borderWidth: 0
                        },
                        warningLine: {
                            type: 'line',
                            yMin: defaultCapacity * 0.8,
                            yMax: defaultCapacity * 0.8,
                            borderColor: 'rgba(245, 158, 11, 0.3)',
                            borderWidth: 1,
                            borderDash: [3, 3]
                        },
                        warningZone: {
                            type: 'box',
                            yMin: defaultCapacity * 0.8,
                            yMax: defaultCapacity,
                            backgroundColor: 'rgba(245, 158, 11, 0.05)',
                            borderWidth: 0
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    grid: {
                        display: false
                    }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Number of Projects'
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                }
            }
        }
    });
}

// Create specialists phase distribution chart
function createSpecialistsPhaseChart() {
    destroyChart('specialistsPhaseChart');

    // Get all unique specialists (from all fields, not just assigned ones)
    const specialistSet = new Set();
    filteredData.forEach(p => {
        const allSpecialists = getAllSpecialistsFromField(p['OH Specialist(s)']);
        allSpecialists.forEach(s => specialistSet.add(s));
    });
    const specialists = [...specialistSet];
    const capacities = specialists.map(person => calculateResourceCapacity(person, 'Specialist'));

    // Sort by total project count descending
    capacities.sort((a, b) => b.totalProjects - a.totalProjects);

    const ctx = document.getElementById('specialistsPhaseChart');
    if (!ctx) return;

    // Phase labels and colors (same as leads chart)
    const phases = [
        { key: 'preKickoff30Plus', label: 'Pre-Kickoff (>30d)', color: '#e0f2fe' },
        { key: 'preKickoff0to30', label: 'Pre-Kickoff (0-30d)', color: '#7dd3fc' },
        { key: 'activePreTesting', label: 'Active Pre-Testing', color: '#2563eb' },
        { key: 'activeTesting', label: 'Active Testing', color: '#1e40af' },
        { key: 'activePostTesting', label: 'Active Post-Testing', color: '#8b5cf6' },
        { key: 'postGoLive0to30', label: 'Post-Go-Live (0-30d)', color: '#a78bfa' },
        { key: 'postGoLive30Plus', label: 'Post-Go-Live (>30d)', color: '#e9d5ff' },
        { key: 'unknown', label: 'Unknown Phase', color: '#d1d5db' }
    ];

    // Create datasets for each phase
    const datasets = phases.map(phase => ({
        label: phase.label,
        data: capacities.map(c => c.phaseCounts[phase.key] || 0),
        backgroundColor: phase.color,
        stack: 'Stack 0'
    }));

    // Calculate max value for capacity zone lines
    const maxProjects = Math.max(...capacities.map(c => c.totalProjects), 10);
    const defaultCapacity = capacityConfig.defaultSpecialistCapacity;

    charts.specialistsPhaseChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: capacities.map(c => c.person),
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.parsed.y} projects`;
                        },
                        footer: function(tooltipItems) {
                            const capacity = capacities[tooltipItems[0].dataIndex];
                            return [
                                `Total: ${capacity.totalProjects} projects`,
                                `Weighted: ${capacity.weightedCapacity} / ${capacity.maxCapacity}`,
                                `Utilization: ${capacity.utilization}%`
                            ];
                        }
                    }
                },
                annotation: {
                    annotations: {
                        criticalLine: {
                            type: 'line',
                            yMin: defaultCapacity,
                            yMax: defaultCapacity,
                            borderColor: 'rgba(239, 68, 68, 0.3)',
                            borderWidth: 2,
                            borderDash: [5, 5],
                            label: {
                                display: true,
                                content: `Capacity: ${defaultCapacity}`,
                                position: 'end'
                            }
                        },
                        criticalZone: {
                            type: 'box',
                            yMin: defaultCapacity,
                            yMax: maxProjects + 2,
                            backgroundColor: 'rgba(239, 68, 68, 0.05)',
                            borderWidth: 0
                        },
                        warningLine: {
                            type: 'line',
                            yMin: defaultCapacity * 0.8,
                            yMax: defaultCapacity * 0.8,
                            borderColor: 'rgba(245, 158, 11, 0.3)',
                            borderWidth: 1,
                            borderDash: [3, 3]
                        },
                        warningZone: {
                            type: 'box',
                            yMin: defaultCapacity * 0.8,
                            yMax: defaultCapacity,
                            backgroundColor: 'rgba(245, 158, 11, 0.05)',
                            borderWidth: 0
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    grid: {
                        display: false
                    }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Number of Projects'
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                }
            }
        }
    });
}
