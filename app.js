// Global variables
let projectData = [];
let filteredData = [];
let charts = {};

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('csvFileInput');
    fileInput.addEventListener('change', handleFileUpload);
});

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

// Parse CSV data with proper handling of quoted fields
function parseCSV(csvText) {
    const lines = csvText.trim().split(/\r?\n/);

    // Parse a single CSV line, handling quoted fields properly
    function parseLine(line) {
        const fields = [];
        let currentField = '';
        let insideQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];

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
            } else {
                currentField += char;
            }
        }

        // Add the last field
        fields.push(currentField.trim());

        return fields;
    }

    // Parse header
    const headers = parseLine(lines[0]);

    // Parse data rows
    projectData = [];
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '') continue;

        const values = parseLine(lines[i]);
        const row = {};

        headers.forEach((header, index) => {
            row[header] = values[index] || '';
        });

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
    createCharts();
    renderTable();
}

// Populate filter dropdowns
function populateFilters() {
    const regions = [...new Set(projectData.map(p => p['OH Region']).filter(r => r))];
    const statuses = [...new Set(projectData.map(p => p['Project Status']).filter(s => s))];
    const types = [...new Set(projectData.map(p => p['Project Type']).filter(t => t))];
    const leads = [...new Set(projectData.map(p => p['OH Project Lead']).filter(l => l))];

    populateSelect('regionFilter', regions);
    populateSelect('statusFilter', statuses);
    populateSelect('typeFilter', types);
    populateSelect('leadFilter', leads);
}

function populateSelect(id, options) {
    const select = document.getElementById(id);
    const currentValue = select.value;

    // Keep "All" option
    select.innerHTML = `<option value="all">${select.options[0].text}</option>`;

    options.sort().forEach(option => {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option;
        select.appendChild(opt);
    });

    if (currentValue && options.includes(currentValue)) {
        select.value = currentValue;
    }
}

// Update key metrics
function updateMetrics() {
    const metricsGrid = document.getElementById('metricsGrid');

    const totalProjects = filteredData.length;
    const activeProjects = filteredData.filter(p =>
        p['Project Status'] && !p['Project Status'].toLowerCase().includes('complete') &&
        !p['Project Status'].toLowerCase().includes('closed')
    ).length;

    const uniqueLeads = new Set(filteredData.map(p => p['OH Project Lead']).filter(l => l)).size;
    const uniqueSpecialists = new Set(filteredData.map(p => p['OH Specialist(s)']).filter(s => s)).size;

    // Calculate upcoming go-lives (next 60 days)
    const now = new Date();
    const sixtyDaysFromNow = new Date(now.getTime() + (60 * 24 * 60 * 60 * 1000));
    const upcomingGoLives = filteredData.filter(p => {
        const date = parseDate(p['OH Go-Live Date']);
        return date && date > now && date <= sixtyDaysFromNow;
    }).length;

    // Calculate projects in testing
    const inTesting = filteredData.filter(p => {
        const testStart = parseDate(p['Testing Start']);
        const testEnd = parseDate(p['Testing End']);
        return testStart && testEnd && testStart <= now && testEnd >= now;
    }).length;

    // Date range
    const dates = filteredData.map(p => parseDate(p['OH Go-Live Date'])).filter(d => d);
    let dateRangeText = 'No date data';
    if (dates.length > 0) {
        const minDate = new Date(Math.min(...dates));
        const maxDate = new Date(Math.max(...dates));
        dateRangeText = `${formatDate(minDate)} - ${formatDate(maxDate)}`;
    }
    document.getElementById('dateRangeDisplay').textContent = dateRangeText;

    const metrics = [
        { label: 'Total Projects', value: totalProjects, subtitle: 'All projects' },
        { label: 'Active Projects', value: activeProjects, subtitle: 'In progress' },
        { label: 'Upcoming Go-Lives', value: upcomingGoLives, subtitle: 'Next 60 days' },
        { label: 'In Testing', value: inTesting, subtitle: 'Currently testing' },
        { label: 'Project Leads', value: uniqueLeads, subtitle: 'Unique leads' },
        { label: 'Specialists', value: uniqueSpecialists, subtitle: 'Unique specialists' }
    ];

    metricsGrid.innerHTML = metrics.map(m => `
        <div class="metric-card">
            <div class="metric-label">${m.label}</div>
            <div class="metric-value">${m.value}</div>
            <div class="metric-subtitle">${m.subtitle}</div>
        </div>
    `).join('');
}

// Create all charts
function createCharts() {
    createTimelineChart();
    createLeadWorkloadChart();
    createSpecialistWorkloadChart();
    populateLeadTimelineSelect();
    populateSpecialistTimelineSelect();
    createLeadTimelineChart();
    createSpecialistTimelineChart();
    createRegionChart();
    createStatusChart();
    createTypeChart();
    createGoLiveChart();
    createTestingChart();
}

// Timeline Chart - Concurrent Active Projects and Testing over time
function createTimelineChart() {
    destroyChart('timelineChart');

    // Collect all projects with valid kick-off and go-live dates
    const projectsWithDates = filteredData
        .map(project => ({
            kickOff: parseDate(project['Kick-Off Date']),
            goLive: parseDate(project['OH Go-Live Date']),
            testStart: parseDate(project['Testing Start']),
            testEnd: parseDate(project['Testing End']),
            project: project
        }))
        .filter(p => p.kickOff && p.goLive);

    // Collect projects with valid testing dates
    const projectsWithTestingDates = filteredData
        .map(project => ({
            testStart: parseDate(project['Testing Start']),
            testEnd: parseDate(project['Testing End']),
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

    // Generate all months in the range
    const months = [];
    const currentMonth = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    const endMonth = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);

    while (currentMonth <= endMonth) {
        months.push(new Date(currentMonth));
        currentMonth.setMonth(currentMonth.getMonth() + 1);
    }

    // For each month, count how many projects are active (Kick-Off to Go-Live)
    const activeProjectCounts = months.map(month => {
        const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0); // Last day of month

        return projectsWithDates.filter(p => {
            // Project is active if it started on or before the end of this month
            // AND ends on or after the start of this month
            return p.kickOff <= monthEnd && p.goLive >= month;
        }).length;
    });

    // For each month, count how many projects are in testing (Testing Start to Testing End)
    const testingProjectCounts = months.map(month => {
        const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0); // Last day of month

        return projectsWithTestingDates.filter(p => {
            // Project is in testing if it started testing on or before the end of this month
            // AND finished testing on or after the start of this month
            return p.testStart <= monthEnd && p.testEnd >= month;
        }).length;
    });

    // Format labels
    const labels = months.map(m => `${getMonthName(m.getMonth())} ${m.getFullYear()}`);

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

    if (selectedLeads.length === 0) {
        return;
    }

    // Get all projects with dates for selected leads
    const leadProjects = {};
    selectedLeads.forEach(lead => {
        leadProjects[lead] = filteredData
            .filter(p => p['OH Project Lead'] === lead)
            .map(project => ({
                kickOff: parseDate(project['Kick-Off Date']),
                goLive: parseDate(project['OH Go-Live Date']),
                project: project
            }))
            .filter(p => p.kickOff && p.goLive);
    });

    // Find overall date range
    const allDates = [];
    Object.values(leadProjects).forEach(projects => {
        projects.forEach(p => {
            allDates.push(p.kickOff, p.goLive);
        });
    });

    if (allDates.length === 0) {
        return;
    }

    const minDate = new Date(Math.min(...allDates));
    const maxDate = new Date(Math.max(...allDates));

    // Generate all months in the range
    const months = [];
    const currentMonth = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    const endMonth = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);

    while (currentMonth <= endMonth) {
        months.push(new Date(currentMonth));
        currentMonth.setMonth(currentMonth.getMonth() + 1);
    }

    // Create datasets for each lead
    const colors = [
        '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
        '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#14b8a6'
    ];

    const datasets = selectedLeads.map((lead, index) => {
        const projectCounts = months.map(month => {
            const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
            return leadProjects[lead].filter(p => {
                return p.kickOff <= monthEnd && p.goLive >= month;
            }).length;
        });

        return {
            label: lead,
            data: projectCounts,
            borderColor: colors[index % colors.length],
            backgroundColor: colors[index % colors.length] + '20',
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5
        };
    });

    const labels = months.map(m => `${getMonthName(m.getMonth())} ${m.getFullYear()}`);

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

    if (selectedSpecialists.length === 0) {
        return;
    }

    // Get all projects with dates for selected specialists
    const specialistProjects = {};
    selectedSpecialists.forEach(specialist => {
        specialistProjects[specialist] = [];
        filteredData.forEach(project => {
            const specialists = project['OH Specialist(s)'];
            if (specialists) {
                const specialistList = specialists.split(/[;,]/).map(s => s.trim()).filter(s => s);
                if (specialistList.includes(specialist)) {
                    const kickOff = parseDate(project['Kick-Off Date']);
                    const goLive = parseDate(project['OH Go-Live Date']);
                    if (kickOff && goLive) {
                        specialistProjects[specialist].push({
                            kickOff: kickOff,
                            goLive: goLive,
                            project: project
                        });
                    }
                }
            }
        });
    });

    // Find overall date range
    const allDates = [];
    Object.values(specialistProjects).forEach(projects => {
        projects.forEach(p => {
            allDates.push(p.kickOff, p.goLive);
        });
    });

    if (allDates.length === 0) {
        return;
    }

    const minDate = new Date(Math.min(...allDates));
    const maxDate = new Date(Math.max(...allDates));

    // Generate all months in the range
    const months = [];
    const currentMonth = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    const endMonth = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);

    while (currentMonth <= endMonth) {
        months.push(new Date(currentMonth));
        currentMonth.setMonth(currentMonth.getMonth() + 1);
    }

    // Create datasets for each specialist
    const colors = [
        '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
        '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#14b8a6'
    ];

    const datasets = selectedSpecialists.map((specialist, index) => {
        const projectCounts = months.map(month => {
            const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
            return specialistProjects[specialist].filter(p => {
                return p.kickOff <= monthEnd && p.goLive >= month;
            }).length;
        });

        return {
            label: specialist,
            data: projectCounts,
            borderColor: colors[index % colors.length],
            backgroundColor: colors[index % colors.length] + '20',
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5
        };
    });

    const labels = months.map(m => `${getMonthName(m.getMonth())} ${m.getFullYear()}`);

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
        const goLiveDate = parseDate(project['OH Go-Live Date']);
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
        const testStart = parseDate(project['Testing Start']);
        const testEnd = parseDate(project['Testing End']);

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

// Apply filters
function applyFilters() {
    const regionFilter = document.getElementById('regionFilter').value;
    const statusFilter = document.getElementById('statusFilter').value;
    const typeFilter = document.getElementById('typeFilter').value;
    const leadFilter = document.getElementById('leadFilter').value;

    filteredData = projectData.filter(project => {
        return (regionFilter === 'all' || project['OH Region'] === regionFilter) &&
               (statusFilter === 'all' || project['Project Status'] === statusFilter) &&
               (typeFilter === 'all' || project['Project Type'] === typeFilter) &&
               (leadFilter === 'all' || project['OH Project Lead'] === leadFilter);
    });

    updateMetrics();
    createCharts();
    renderTable();
}

// Clear all filters
function clearFilters() {
    document.getElementById('regionFilter').value = 'all';
    document.getElementById('statusFilter').value = 'all';
    document.getElementById('typeFilter').value = 'all';
    document.getElementById('leadFilter').value = 'all';
    document.getElementById('searchBox').value = '';

    filteredData = [...projectData];
    updateMetrics();
    createCharts();
    renderTable();
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
