// Self-contained HTML page for the insights dashboard, served as a template string since this function
// directory has no static-file bundling (that requires a config.toml entry this module doesn't own).
// Keep this file free of backticks/${} inside the embedded <script> — it all lives inside one outer
// template literal, so client-side JS below uses string concatenation instead of template literals.
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conversation insights</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<style>
  :root {
    --surface-1: #fcfcfb;
    --page-plane: #f9f9f7;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --text-muted: #898781;
    --gridline: #e1e0d9;
    --baseline: #c3c2b7;
    --border: rgba(11, 11, 11, 0.10);
    --status-warning: #fab219;
    --status-warning-wash: rgba(250, 178, 25, 0.12);
    --series-1: #2a78d6;
    --series-2: #1baf7a;
    --series-3: #eda100;
    --series-4: #008300;
    --series-5: #4a3aa7;
    --series-6: #e34948;
    --series-7: #e87ba4;
    --series-8: #eb6834;
    --series-other: #898781;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --surface-1: #1a1a19;
      --page-plane: #0d0d0d;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --text-muted: #898781;
      --gridline: #2c2c2a;
      --baseline: #383835;
      --border: rgba(255, 255, 255, 0.10);
      --status-warning: #fab219;
      --status-warning-wash: rgba(250, 178, 25, 0.10);
      --series-1: #3987e5;
      --series-2: #199e70;
      --series-3: #c98500;
      --series-4: #008300;
      --series-5: #9085e9;
      --series-6: #e66767;
      --series-7: #d55181;
      --series-8: #d95926;
      --series-other: #898781;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px 16px 64px;
    background: var(--page-plane);
    color: var(--text-primary);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .wrap { max-width: 1080px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .subtitle { color: var(--text-secondary); font-size: 14px; margin: 0 0 24px; }
  .card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 20px;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 20px;
  }
  @media (max-width: 720px) {
    .tiles { grid-template-columns: repeat(2, 1fr); }
  }
  .tile-label {
    font-size: 12px;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .tile-value {
    font-size: 28px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    margin-top: 6px;
  }
  h2 { font-size: 16px; margin: 0 0 16px; }
  .chart-holder { position: relative; height: 340px; }
  .empty-state {
    color: var(--text-secondary);
    font-size: 14px;
    padding: 32px 0;
    text-align: center;
  }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th {
    text-align: left;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
    padding: 6px 10px;
    border-bottom: 1px solid var(--gridline);
    white-space: nowrap;
  }
  td {
    padding: 10px;
    border-bottom: 1px solid var(--gridline);
    vertical-align: top;
  }
  tr.warn-row td:first-child {
    border-left: 3px solid var(--status-warning);
    background: var(--status-warning-wash);
  }
  .tag-pill {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--gridline);
    color: var(--text-primary);
    font-size: 12px;
    white-space: nowrap;
  }
  .date-cell { white-space: nowrap; color: var(--text-secondary); }
  a { color: var(--series-1); }
  .table-wrap { overflow-x: auto; }
  .warn-icon { margin-right: 6px; }
  .table-scroll { max-height: 480px; overflow-y: auto; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Conversation insights</h1>
  <p class="subtitle">AI-tagged SMS conversations with Detroit residents</p>

  <div class="tiles" id="tiles">
    <div class="card">
      <div class="tile-label">Total analyzed</div>
      <div class="tile-value" id="tile-total">&ndash;</div>
    </div>
    <div class="card">
      <div class="tile-label">Last 7 days</div>
      <div class="tile-value" id="tile-last7">&ndash;</div>
    </div>
    <div class="card">
      <div class="tile-label">Unmet demand (30d)</div>
      <div class="tile-value" id="tile-unmet">&ndash;</div>
    </div>
    <div class="card">
      <div class="tile-label">Promoted stories</div>
      <div class="tile-value" id="tile-promoted">&ndash;</div>
    </div>
  </div>

  <div class="card">
    <h2>Weekly conversations by tag</h2>
    <div class="chart-holder" id="chart-holder">
      <canvas id="tags-chart"></canvas>
    </div>
  </div>

  <div class="card">
    <h2><span class="warn-icon">⚠️</span>Unmet demand</h2>
    <div class="table-wrap">
      <div class="table-scroll" id="unmet-table-holder"></div>
    </div>
  </div>
</div>

<script>
(function () {
  var TOP_TAG_LIMIT = 8
  var SERIES_COLORS = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6', '--series-7', '--series-8']

  var params = new URLSearchParams(window.location.search)
  var token = params.get('token')

  function withToken(path) {
    var url = new URL(path, window.location.href)
    if (token) url.searchParams.set('token', token)
    return url.toString()
  }

  function fetchJson(path) {
    return fetch(withToken(path)).then(function (res) {
      if (!res.ok) {
        throw new Error('Request to ' + path + ' failed with status ' + res.status)
      }
      return res.json()
    })
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  }

  function formatNumber(n) {
    return (n || 0).toLocaleString()
  }

  function formatDate(iso) {
    if (!iso) return 'unknown'
    var d = new Date(iso)
    if (isNaN(d.getTime())) return 'unknown'
    return d.toISOString().slice(0, 10)
  }

  function escapeHtml(value) {
    var div = document.createElement('div')
    div.textContent = value == null ? '' : String(value)
    return div.innerHTML
  }

  function renderSummary(data) {
    document.getElementById('tile-total').textContent = formatNumber(data.total)
    document.getElementById('tile-last7').textContent = formatNumber(data.last7Days)
    document.getElementById('tile-unmet').textContent = formatNumber(data.unmetDemandLast30Days)
    document.getElementById('tile-promoted').textContent = formatNumber(data.promotedTotal)
  }

  function bucketTopTagsPlusOther(rows) {
    var totalsByTag = {}
    var weekSet = {}
    rows.forEach(function (row) {
      if (!row.tag) return
      totalsByTag[row.tag] = (totalsByTag[row.tag] || 0) + row.count
      weekSet[row.week] = true
    })

    var weeks = Object.keys(weekSet).sort()
    var topTags = Object.keys(totalsByTag)
      .sort(function (a, b) { return totalsByTag[b] - totalsByTag[a] })
      .slice(0, TOP_TAG_LIMIT)
      .sort()

    var topTagSet = {}
    topTags.forEach(function (tag) { topTagSet[tag] = true })

    var byWeekTag = {}
    rows.forEach(function (row) {
      if (!row.tag) return
      var key = row.week + '|' + row.tag
      byWeekTag[key] = (byWeekTag[key] || 0) + row.count
    })

    var datasets = topTags.map(function (tag, index) {
      var colorVar = SERIES_COLORS[index % SERIES_COLORS.length]
      return {
        label: tag,
        backgroundColor: cssVar(colorVar),
        stack: 'tags',
        borderRadius: 4,
        borderSkipped: false,
        data: weeks.map(function (week) { return byWeekTag[week + '|' + tag] || 0 })
      }
    })

    var otherData = weeks.map(function (week) {
      var sum = 0
      Object.keys(totalsByTag).forEach(function (tag) {
        if (topTagSet[tag]) return
        sum += byWeekTag[week + '|' + tag] || 0
      })
      return sum
    })
    if (otherData.some(function (v) { return v > 0 })) {
      datasets.push({
        label: 'Other',
        backgroundColor: cssVar('--series-other'),
        stack: 'tags',
        borderRadius: 4,
        borderSkipped: false,
        data: otherData
      })
    }

    return { weeks: weeks, datasets: datasets }
  }

  var chartInstance = null

  function renderChart(rows) {
    var holder = document.getElementById('chart-holder')
    if (!rows.length) {
      holder.innerHTML = '<div class="empty-state">No analyses yet</div>'
      return
    }

    var bucketed = bucketTopTagsPlusOther(rows)
    var ink = cssVar('--text-secondary')
    var gridline = cssVar('--gridline')

    var ctx = document.getElementById('tags-chart')
    if (!ctx) {
      holder.innerHTML = '<canvas id="tags-chart"></canvas>'
      ctx = document.getElementById('tags-chart')
    }

    if (chartInstance) chartInstance.destroy()
    chartInstance = new Chart(ctx, {
      type: 'bar',
      data: { labels: bucketed.weeks, datasets: bucketed.datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: ink } },
          y: { stacked: true, beginAtZero: true, grid: { color: gridline }, ticks: { color: ink, precision: 0 } }
        },
        plugins: {
          legend: { position: 'bottom', labels: { color: ink, boxWidth: 12, boxHeight: 12 } },
          tooltip: { mode: 'index', intersect: false }
        }
      }
    })
  }

  function renderUnmetTable(rows) {
    var holder = document.getElementById('unmet-table-holder')
    if (!rows.length) {
      holder.innerHTML = '<div class="empty-state">No unmet demand recorded</div>'
      return
    }

    var html = '<table><thead><tr>' +
      '<th>Date</th><th>Tag</th><th>Summary</th><th>Reason</th><th>Conversation</th>' +
      '</tr></thead><tbody>'

    rows.forEach(function (row) {
      html += '<tr class="warn-row">' +
        '<td class="date-cell">' + escapeHtml(formatDate(row.createdAt)) + '</td>' +
        '<td><span class="tag-pill">' + escapeHtml(row.tag || 'other') + '</span></td>' +
        '<td>' + escapeHtml(row.summary) + '</td>' +
        '<td>' + escapeHtml(row.reason) + '</td>' +
        '<td>' + (row.missiveUrl ? '<a href="' + escapeHtml(row.missiveUrl) + '" target="_blank" rel="noopener">Open in Missive</a>' : '–') + '</td>' +
        '</tr>'
    })

    html += '</tbody></table>'
    holder.innerHTML = html
  }

  function showError(message) {
    document.getElementById('tiles').innerHTML = '<div class="card empty-state">' + escapeHtml(message) + '</div>'
    document.getElementById('chart-holder').innerHTML = '<div class="empty-state">' + escapeHtml(message) + '</div>'
    document.getElementById('unmet-table-holder').innerHTML = '<div class="empty-state">' + escapeHtml(message) + '</div>'
  }

  Promise.all([
    fetchJson('data/summary'),
    fetchJson('data/tags-over-time?weeks=12'),
    fetchJson('data/unmet-demand?limit=50')
  ]).then(function (results) {
    renderSummary(results[0])
    renderChart(results[1])
    renderUnmetTable(results[2])
  }).catch(function (error) {
    console.error('Failed to load dashboard data', error)
    showError('Could not load dashboard data. Check the link (token) and try again.')
  })

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      fetchJson('data/tags-over-time?weeks=12').then(renderChart).catch(function () {})
    })
  }
})()
</script>
</body>
</html>
`
