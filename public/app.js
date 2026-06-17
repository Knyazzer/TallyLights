const $ = (sel) => document.querySelector(sel)
const api = (url, opts) => fetch(url, opts).then(r => r.ok ? r.json() : Promise.reject(r))

let config = null

async function loadConfig() {
  config = await api('/api/config')
  $('#baudRate').value = config.baudRate ?? 57600
  $('#atemIp').value = config.atem?.ip ?? ''
  $('#httpPort').value = config.http?.port ?? 8080
  $('#defaultMode').value = config.defaultMode ?? 'atem'
  $('#onAtemDisconnect').value = config.onAtemDisconnect ?? 'hold'
  await loadPorts()
  renderLampTable()
}

async function loadPorts() {
  const ports = await api('/api/ports')
  const sel = $('#comPort')
  sel.innerHTML = ''
  for (const p of ports) {
    const o = document.createElement('option')
    o.value = p.path; o.textContent = p.path
    sel.appendChild(o)
  }
  if (config.comPort) sel.value = config.comPort
}

function renderLampTable() {
  const tbody = $('#lamp-table tbody')
  tbody.innerHTML = ''
  for (const l of (config.lamps || [])) addLampRow(l)
}

function addLampRow(l = { id: '', atemInput: '', previewPin: '', activePin: '' }) {
  const tr = document.createElement('tr')
  for (const f of ['id', 'atemInput', 'previewPin', 'activePin']) {
    const td = document.createElement('td')
    const inp = document.createElement('input')
    inp.type = 'number'; inp.dataset.field = f; inp.value = l[f]
    td.appendChild(inp); tr.appendChild(td)
  }
  const td = document.createElement('td')
  const del = document.createElement('button')
  del.type = 'button'; del.textContent = '×'
  del.onclick = () => tr.remove()
  td.appendChild(del); tr.appendChild(td)
  $('#lamp-table tbody').appendChild(tr)
}

function collectConfig() {
  const lamps = [...document.querySelectorAll('#lamp-table tbody tr')].map(tr => {
    const o = {}
    tr.querySelectorAll('input').forEach(i => { o[i.dataset.field] = Number(i.value) })
    return o
  })
  return {
    comPort: $('#comPort').value,
    baudRate: Number($('#baudRate').value),
    atem: { ip: $('#atemIp').value, enabled: true },
    http: { port: Number($('#httpPort').value), enabled: true },
    defaultMode: $('#defaultMode').value,
    onAtemDisconnect: $('#onAtemDisconnect').value,
    lamps
  }
}

function renderLamps(lamps) {
  const box = $('#lamps')
  box.innerHTML = ''
  for (const l of lamps) {
    const d = document.createElement('div')
    d.className = 'lamp' + (l.program ? ' program' : l.preview ? ' preview' : '')
    d.textContent = l.id
    box.appendChild(d)
  }
}

function setMode(mode) {
  $('#mode-current').textContent = mode
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode))
}

function setStatus(conn) {
  $('#st-atem').classList.toggle('on', !!conn?.atem)
  $('#st-com').classList.toggle('on', !!conn?.com)
}

function connectEvents() {
  const es = new EventSource('/events')
  es.onmessage = (e) => {
    const data = JSON.parse(e.data)
    if (data.mode) setMode(data.mode)
    if (data.lamps) renderLamps(data.lamps)
    if (data.connections) setStatus(data.connections)
  }
}

document.querySelectorAll('.mode-btn').forEach(b => {
  b.onclick = () => api('/mode/' + b.dataset.mode, { method: 'POST' })
})
$('#scan').onclick = async () => {
  const list = $('#atem-list'); list.innerHTML = '<li>сканирование…</li>'
  const found = await api('/api/atem/scan')
  list.innerHTML = ''
  for (const a of found) {
    const li = document.createElement('li')
    li.textContent = a.ip + (a.model ? ` (${a.model})` : '')
    const pick = document.createElement('button')
    pick.textContent = 'выбрать'; pick.onclick = () => { $('#atemIp').value = a.ip }
    li.appendChild(pick); list.appendChild(li)
  }
  if (!found.length) list.innerHTML = '<li>не найдено</li>'
}
$('#add-lamp').onclick = () => addLampRow()
$('#settings').onsubmit = async (e) => {
  e.preventDefault()
  try { await api('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collectConfig()) }); alert('Сохранено') }
  catch { alert('Ошибка валидации конфига') }
}

loadConfig().then(connectEvents)
