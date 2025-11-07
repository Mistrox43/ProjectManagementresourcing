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

// Parse CSV data
function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(h => h.trim().replace(/^"|"$/g, ''));

    projectData = [];
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '') continue;

        const values = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.trim().replace(/^"|"$/g, ''));
        const row = {};

        headers.forEach((header, index) => {
            row[header] = values[index] || '';
        });

        projectData.push(row);
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
    createRegionChart();
    createStatusChart();
    createTypeChart();
    createGoLiveChart();
    createTestingChart();
}

// Timeline Chart - Projects over time
function createTimelineChart() {
    destroyChart('timelineChart');

    const monthlyData = {};
    filteredData.forEach(project => {
        const goLiveDate = parseDate(project['OH Go-Live Date']);
        if (goLiveDate) {
            const monthKey = `${goLiveDate.getFullYear()}-${String(goLiveDate.getMonth() + 1).padStart(2, '0')}`;
            monthlyData[monthKey] = (monthlyData[monthKey] || 0) + 1;
        }
    });

    const sortedMonths = Object.keys(monthlyData).sort();
    const labels = sortedMonths.map(m => {
        const [year, month] = m.split('-');
        return `${getMonthName(parseInt(month) - 1)} ${year}`;
    });
    const values = sortedMonths.map(m => monthlyData[m]);

    const ctx = document.getElementById('timelineChart').getContext('2d');
    charts.timelineChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Projects',
                data: values,
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                tension: 0.4,
                fill: true
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
