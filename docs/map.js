/* Prospect employer map. Leaflet 1.9.4 is loaded locally by index.html. */
const MILE = 1609.344;
const EARTH = 6371000;
const RAD = Math.PI / 180;
const FALLBACK_COLORS = ['#168276', '#ab7c38', '#527eae', '#9a7199', '#7561a8', '#b46c67'];
const BREADTH_COLORS = ['#8fc7af', '#6cb69a', '#449a7e', '#277a65', '#1e6d5a', '#195f51', '#165449', '#124b42', '#10453d', '#0d3d37'];

export class TalentMap {
  constructor(element, options = {}) {
    if (!window.L) throw new Error('The local Leaflet map library could not be loaded.');
    this.L = window.L;
    this.el = typeof element === 'string' ? document.getElementById(element) : element;
    if (!this.el) throw new Error('Map container not found.');
    this.options = options;
    this.origin = options.center;
    if (!Array.isArray(this.origin) || this.origin.length !== 2 || !this.origin.every(Number.isFinite)) throw new Error('The company location is unavailable.');
    this.coverageCenter = options.coverageCenter || this.origin;
    this.coverageRadiusMiles = options.coverageRadiusMiles ?? 25;
    this.groups = new Map((options.groups || []).map(group => [Number(group.number), group]));
    this.records = [];
    this.mode = 'clusters';
    this._pickMode = false;
    this._selectedId = null;
    this._catchment = null;
    this._clusterCache = new Map();
    this._hits = new Map();
    this._drawFrame = null;
    this.el.classList.add('talent-map');
    this.map = this.L.map(this.el, {
      center: this.origin,
      zoom: 11,
      minZoom: options.minZoom ?? 8,
      maxZoom: 18,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
      zoomControl: false,
      preferCanvas: true,
      attributionControl: true,
      maxBounds: options.maxBounds ?? null,
      maxBoundsViscosity: 0.7,
    });
    this.L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    this.L.control.scale({ position: 'bottomleft', imperial: true, metric: false, maxWidth: 100 }).addTo(this.map);
    this.map.attributionControl.setPrefix(false);
    this.tileLayer = this.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      minZoom: options.minZoom ?? 8,
      keepBuffer: 1,
      updateWhenIdle: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(this.map);
    this._notice = document.createElement('div');
    this._notice.className = 'talent-map-notice';
    this._notice.hidden = true;
    this._notice.setAttribute('role', 'status');
    this.el.append(this._notice);
    this._tileErrors = 0;
    this.tileLayer.on('tileerror', () => {
      if (++this._tileErrors >= 4) {
        this._notice.textContent = 'Base map unavailable. Business coordinates and area controls remain available.';
        this._notice.hidden = false;
      }
    });
    this.tileLayer.on('tileload', () => {
      this._tileErrors = 0;
      this._notice.hidden = true;
    });

    this._tooltip = document.createElement('div');
    this._tooltip.className = 'talent-map-hover';
    this._tooltip.hidden = true;
    this.el.append(this._tooltip);
    this._breadthLegend = document.createElement('div');
    this._breadthLegend.className = 'talent-breadth-legend';
    this._breadthLegend.hidden = true;
    this._breadthLegend.innerHTML = '<strong>Groups per cell</strong><div class="talent-breadth-scale"><span><i style="background:#8fc7af"></i>1</span><span><i style="background:#1e6d5a"></i>5</span><span><i style="background:#0d3d37"></i>10+</span></div><small>Distinct groups · approx. 1-mile cells</small>';
    this.el.append(this._breadthLegend);
    this.L.DomEvent.disableClickPropagation(this._breadthLegend);

    const owner = this;
    const CanvasLayer = this.L.Layer.extend({
      onAdd(map) {
        this.canvas = owner.L.DomUtil.create('canvas', 'talent-points-canvas');
        this.canvas.setAttribute('aria-hidden', 'true');
        map.getPanes().overlayPane.appendChild(this.canvas);
        owner.canvas = this.canvas;
        owner.ctx = this.canvas.getContext('2d');
        owner._scheduleDraw();
      },
      onRemove() { this.canvas?.remove(); },
    });
    this._canvasLayer = new CanvasLayer().addTo(this.map);
    this._sourceRing = this.L.circle(this.coverageCenter, {
      radius: this.coverageRadiusMiles * MILE, color: '#71838c', weight: 1.5,
      dashArray: '7 7', fill: false, interactive: false,
    }).addTo(this.map);
    const company = options.company;
    const companyLabel = document.createElement('span');
    companyLabel.textContent = company.name;
    this._originMarker = this.L.marker(this.origin, {
      title: [company.name, company.office].filter(Boolean).join(' · '),
      alt: company.name,
      bubblingMouseEvents: false,
      zIndexOffset: 1000,
      icon: this.L.divIcon({className: 'talent-company-marker', iconSize: [30,30], iconAnchor: [15,15], html: '<span class="talent-company-pin"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11 12 4l8 7v9h-6v-6h-4v6H4z"/></svg></span>'}),
    }).addTo(this.map).bindTooltip(companyLabel, {
      permanent: true, direction: 'right', offset: [19, 0], className: 'talent-origin-label talent-company-label',
    });
    const companyPopup = document.createElement('div');
    const companyHeading = document.createElement('strong'); companyHeading.textContent = company.name; companyPopup.append(companyHeading);
    if (company.address) {
      const companyAddress = document.createElement('p');
      companyAddress.textContent = company.address;
      companyPopup.append(companyAddress);
    }
    if (company.address_source) {
      const addressUrl = new URL(company.address_source);
      if (['http:', 'https:'].includes(addressUrl.protocol)) {
        const companyLink = document.createElement('a');
        companyLink.textContent = 'Official office location ↗';
        Object.assign(companyLink, { href: addressUrl.href, target: '_blank', rel: 'noopener' });
        companyPopup.append(companyLink);
      }
    }
    this._originMarker.bindPopup(companyPopup);
    this._originMarker.on('click', event => {
      if (this._pickMode) {
        this.L.DomEvent.stopPropagation(event);
        this._originMarker.closePopup();
        this._finishPick(this.origin);
      }
    });
    this._catchmentLayers = this.L.layerGroup().addTo(this.map);

    this.map.on('move zoom resize', () => this._scheduleDraw());
    this.map.on('movestart zoomstart', () => { this._tooltip.hidden = true; });
    this.map.on('moveend zoomend', () => {
      this._scheduleDraw();
      this.options.onViewChange?.(this.map.getBounds());
    });
    this.map.on('click', event => this._onClick(event));
    this.map.on('mousemove', event => this._onHover(event));
    this._hideTooltip = () => { this._tooltip.hidden = true; };
    this.el.addEventListener('mouseleave', this._hideTooltip);
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this.resize());
      this._resizeObserver.observe(this.el);
    }
  }

  setRecords(rows) {
    this.records = rows.filter(row => Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lon)));
    this._clusterCache.clear();
    this._breadthCells = this._makeBreadthCells();
    this._tooltip.hidden = true;
    this._scheduleDraw();
  }

  setPriorityColors(colors) {
    this.options.priorityColors = colors;
    this._clusterCache.clear();
    this._scheduleDraw();
  }

  setMode(mode) {
    if (!['clusters', 'locations', 'breadth'].includes(mode)) return;
    this.mode = mode;
    this._breadthLegend.hidden = mode !== 'breadth';
    this._tooltip.hidden = true;
    this._scheduleDraw();
  }

  setCatchment(center, radiusMiles, label = 'Selected area') {
    this._catchmentLayers.clearLayers();
    this._catchment = null;
    if (!center || !Number.isFinite(Number(radiusMiles)) || Number(radiusMiles) <= 0) {
      this._scheduleDraw();
      return;
    }
    this._catchment = { center: [Number(center[0]), Number(center[1])], radius: Number(radiusMiles) * MILE };
    const circle = this.L.circle(center, {
      radius: Number(radiusMiles) * MILE,
      color: '#2f6fbd', weight: 2, fillColor: '#6b9fd8', fillOpacity: 0.045,
      interactive: false, dashArray: '5 5',
    });
    this._catchmentLayers.addLayer(circle);
    const fromOrigin = this.map.distance(center, this.origin);
    if (fromOrigin > 10) {
      const marker = this.L.circleMarker(center, {
        radius: 5.5, color: '#fff', weight: 2, fillColor: '#2f6fbd', fillOpacity: 1,
        interactive: false,
      }).bindTooltip(String(label), { direction: 'top', permanent: false, className: 'talent-origin-label' });
      this._catchmentLayers.addLayer(marker);
    }
    this._scheduleDraw();
  }

  setPickMode(enabled) {
    this._pickMode = Boolean(enabled);
    this.el.classList.toggle('talent-map-picking', this._pickMode);
    this._tooltip.hidden = true;
    this.el.style.cursor = this._pickMode ? 'crosshair' : '';
  }

  focus(row) {
    if (!row || !Number.isFinite(Number(row.lat)) || !Number.isFinite(Number(row.lon))) return;
    this._selectedId = row.id;
    this.map.setView([Number(row.lat), Number(row.lon)], Math.max(14, this.map.getZoom()), { animate: true });
    this._scheduleDraw();
  }

  fit() {
    this.map.fitBounds(this.L.latLng(this.origin).toBounds(2 * this.coverageRadiusMiles * MILE), {
      padding: [26, 26], maxZoom: 14,
    });
  }

  resize() {
    this.map.invalidateSize({ pan: false, debounceMoveend: true });
    this._scheduleDraw();
  }

  destroy() {
    this._resizeObserver?.disconnect();
    this.el.removeEventListener('mouseleave', this._hideTooltip);
    if (this._drawFrame !== null) cancelAnimationFrame(this._drawFrame);
    this.map.remove();
  }

  _groups(row) {
    return (Array.isArray(row.activeGroups) ? row.activeGroups : row.groups || []).map(Number);
  }

  _color(groupNumber) {
    if (!Number.isFinite(Number(groupNumber)) || Number(groupNumber) < 1) return '#85919a';
    return this.groups.get(Number(groupNumber))?.color || FALLBACK_COLORS[(Number(groupNumber) || 0) % FALLBACK_COLORS.length];
  }

  _areaOpacity(latLng) {
    if (!this._catchment) return 1;
    return this.map.distance(latLng, this._catchment.center) <= this._catchment.radius ? 1 : .18;
  }

  _scheduleDraw() {
    if (this._drawFrame !== null) return;
    this._drawFrame = requestAnimationFrame(() => {
      this._drawFrame = null;
      this._draw();
    });
  }

  _draw() {
    if (!this.canvas || !this.ctx) return;
    const size = this.map.getSize();
    if (!size.x || !size.y) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(size.x * ratio) || this.canvas.height !== Math.round(size.y * ratio)) {
      this.canvas.width = Math.round(size.x * ratio);
      this.canvas.height = Math.round(size.y * ratio);
      this.canvas.style.width = `${size.x}px`;
      this.canvas.style.height = `${size.y}px`;
    }
    this.L.DomUtil.setPosition(this.canvas, this.map.containerPointToLayerPoint([0, 0]));
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.ctx.clearRect(0, 0, size.x, size.y);
    this._hits.clear();
    if (this.mode === 'breadth') this._drawBreadth(size);
    else if (this.mode === 'locations') this._drawLocations(size);
    else this._drawClusters(size);
    const selected = this.records.find(row => row.id === this._selectedId);
    if (selected) {
      const point = this.map.latLngToContainerPoint([Number(selected.lat), Number(selected.lon)]);
      this.ctx.beginPath(); this.ctx.arc(point.x, point.y, 11, 0, Math.PI * 2);
      this.ctx.strokeStyle = '#162f40'; this.ctx.lineWidth = 2.5; this.ctx.stroke();
      this.ctx.beginPath(); this.ctx.arc(point.x, point.y, 13.5, 0, Math.PI * 2);
      this.ctx.strokeStyle = '#fff'; this.ctx.lineWidth = 2; this.ctx.stroke();
    }
  }

  _makeClusters(zoom) {
    if (this._clusterCache.has(zoom)) return this._clusterCache.get(zoom);
    const bins = new Map();
    const grid = 52;
    for (const row of this.records) {
      const point = this.map.project([Number(row.lat), Number(row.lon)], zoom);
      const key = `${Math.floor(point.x / grid)},${Math.floor(point.y / grid)}`;
      let cell = bins.get(key);
      if (!cell) bins.set(key, cell = { rows: [], x: 0, y: 0, groups: new Set(), groupCounts: new Map() });
      cell.rows.push(row); cell.x += point.x; cell.y += point.y;
      for (const group of this._groups(row)) {
        cell.groups.add(group);
        cell.groupCounts.set(group, (cell.groupCounts.get(group) || 0) + 1);
      }
    }
    for (const cell of bins.values()) {
      cell.x /= cell.rows.length; cell.y /= cell.rows.length;
      cell.mainGroup = [...cell.groupCounts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
      if (this.options.priorityColors) {
        const counts = new Map();
        for (const row of cell.rows) counts.set(row.transfer_tier, (counts.get(row.transfer_tier) || 0) + 1);
        cell.mainTier = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
      }
    }
    this._clusterCache.set(zoom, [...bins.values()]);
    // Fractional and touch zooms can create many exact zoom values.
    if (this._clusterCache.size > 12) this._clusterCache.delete(this._clusterCache.keys().next().value);
    return this._clusterCache.get(zoom);
  }

  _drawClusters(size) {
    const origin = this.map.getPixelOrigin();
    const ctx = this.ctx;
    for (const cell of this._makeClusters(this.map.getZoom())) {
      const point = this.map.layerPointToContainerPoint(this.L.point(cell.x - origin.x, cell.y - origin.y));
      const count = cell.rows.length;
      const radius = count === 1 ? 5 : Math.min(25, 12 + Math.log2(count) * 1.45);
      if (point.x < -radius || point.y < -radius || point.x > size.x + radius || point.y > size.y + radius) continue;
      const opacity = this._areaOpacity(this.map.unproject([cell.x, cell.y], this.map.getZoom()));
      ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = this.options.priorityColors?.[cell.mainTier] || this._color(cell.mainGroup);
      ctx.globalAlpha = (count === 1 ? 0.943 : 0.94) * opacity;
      ctx.fill(); ctx.globalAlpha = opacity;
      ctx.strokeStyle = 'rgba(255,255,255,.96)'; ctx.lineWidth = count === 1 ? 1.3 : 2; ctx.stroke();
      if (count > 1) {
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `600 ${count < 100 ? 11 : 10}px system-ui, sans-serif`;
        ctx.fillText(count > 999 ? `${(count / 1000).toFixed(1)}k` : String(count), point.x, point.y + .4);
      }
      ctx.globalAlpha = 1;
      this._addHit({ type: count === 1 ? 'business' : 'cluster', row: count === 1 ? cell.rows[0] : null, cell, x: point.x, y: point.y, radius: radius + 4 });
    }
  }

  _drawLocations(size) {
    const ctx = this.ctx;
    const bounds = this.map.getBounds().pad(.02);
    const radius = this.map.getZoom() < 12 ? 3.1 : 4.2;
    for (const row of this.records) {
      const latLng = [Number(row.lat), Number(row.lon)];
      if (!bounds.contains(latLng)) continue;
      const point = this.map.latLngToContainerPoint(latLng);
      if (point.x < -6 || point.y < -6 || point.x > size.x + 6 || point.y > size.y + 6) continue;
      const opacity = this._areaOpacity(latLng);
      ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = this.options.priorityColors?.[row.transfer_tier] || this._color(this._groups(row)[0]); ctx.globalAlpha = .943 * opacity; ctx.fill(); ctx.globalAlpha = opacity;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = .8; ctx.stroke();
      ctx.globalAlpha = 1;
      this._addHit({ type: 'business', row, x: point.x, y: point.y, radius: radius + 4 });
    }
  }

  _makeBreadthCells() {
    const dLat = MILE / EARTH / RAD;
    const dLon = MILE / (EARTH * Math.cos(this.origin[0] * RAD)) / RAD;
    const cells = new Map();
    for (const row of this.records) {
      const x = Math.floor((Number(row.lon) - this.origin[1]) / dLon);
      const y = Math.floor((Number(row.lat) - this.origin[0]) / dLat);
      const key = `${x},${y}`;
      let cell = cells.get(key);
      if (!cell) {
        const south = this.origin[0] + y * dLat;
        const west = this.origin[1] + x * dLon;
        cells.set(key, cell = {
          key, count: 0, groups: new Set(),
          south, west, north: south + dLat, east: west + dLon,
          center: [south + dLat / 2, west + dLon / 2],
        });
      }
      cell.count++;
      for (const group of this._groups(row)) cell.groups.add(group);
    }
    return [...cells.values()];
  }

  _drawBreadth(size) {
    const ctx = this.ctx;
    for (const cell of this._breadthCells || []) {
      const nw = this.map.latLngToContainerPoint([cell.north, cell.west]);
      const se = this.map.latLngToContainerPoint([cell.south, cell.east]);
      if (se.x < 0 || se.y < 0 || nw.x > size.x || nw.y > size.y) continue;
      const breadth = cell.groups.size;
      ctx.globalAlpha = this._areaOpacity(cell.center);
      ctx.fillStyle = breadth ? `${BREADTH_COLORS[Math.min(9, breadth - 1)]}e6` : 'rgba(142,151,160,.3)';
      const width = se.x - nw.x, height = se.y - nw.y;
      ctx.fillRect(nw.x + 1, nw.y + 1, Math.max(0, width - 2), Math.max(0, height - 2));
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1;
      ctx.strokeRect(nw.x + 1, nw.y + 1, Math.max(0, width - 2), Math.max(0, height - 2));
      if (width > 25 && height > 25) {
        ctx.fillStyle = breadth >= 4 ? '#fff' : '#102f2c';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '700 12px system-ui, sans-serif';
        ctx.fillText(String(breadth), nw.x + width / 2, nw.y + height / 2);
      }
      ctx.globalAlpha = 1;
      this._addHit({ type: 'area', cell, rect: { left: nw.x, top: nw.y, right: se.x, bottom: se.y } });
    }
  }

  _addHit(hit) {
    const rect = hit.rect || { left: hit.x - hit.radius, top: hit.y - hit.radius, right: hit.x + hit.radius, bottom: hit.y + hit.radius };
    const size = this.map.getSize();
    const minX = Math.floor(Math.max(-32, rect.left) / 32), maxX = Math.floor(Math.min(size.x + 32, rect.right) / 32);
    const minY = Math.floor(Math.max(-32, rect.top) / 32), maxY = Math.floor(Math.min(size.y + 32, rect.bottom) / 32);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const key = `${x},${y}`;
        if (!this._hits.has(key)) this._hits.set(key, []);
        this._hits.get(key).push(hit);
      }
    }
  }

  _hitTest(point) {
    const bucket = this._hits.get(`${Math.floor(point.x / 32)},${Math.floor(point.y / 32)}`) || [];
    for (let index = bucket.length - 1; index >= 0; index--) {
      const hit = bucket[index];
      if (hit.rect) {
        if (point.x >= hit.rect.left && point.x <= hit.rect.right && point.y >= hit.rect.top && point.y <= hit.rect.bottom) return hit;
      } else if ((point.x - hit.x) ** 2 + (point.y - hit.y) ** 2 <= hit.radius ** 2) return hit;
    }
    return null;
  }

  _onHover(event) {
    if (this._pickMode) return;
    const hit = this._hitTest(event.containerPoint);
    this.el.style.cursor = hit ? 'pointer' : '';
    if (!hit) { this._tooltip.hidden = true; return; }
    let text = '';
    if (hit.type === 'business') {
      text = `${hit.row.name}\n${[hit.row.city, hit.row.state].filter(Boolean).join(', ')}`;
    } else if (hit.type === 'cluster') {
      text = `${hit.cell.rows.length.toLocaleString()} filtered locations · ${hit.cell.groups.size} mapped groups\nFull cluster count, including any outside the focus circle\nClick to zoom`;
    } else {
      text = `${hit.cell.groups.size} mapped groups · ${hit.cell.count.toLocaleString()} locations\nApprox. 1-mile cell · click to inspect a 2-mile area`;
    }
    this._tooltip.textContent = text;
    this._tooltip.hidden = false;
    const size = this.map.getSize();
    const left = Math.max(8, Math.min(event.containerPoint.x + 16, size.x - this._tooltip.offsetWidth - 8));
    const top = Math.max(8, Math.min(event.containerPoint.y + 16, size.y - this._tooltip.offsetHeight - 8));
    this._tooltip.style.left = `${left}px`;
    this._tooltip.style.top = `${top}px`;
  }

  _finishPick(center) {
    this.setPickMode(false);
    this.options.onCenterPick?.([Number(center[0]), Number(center[1])]);
  }

  _onClick(event) {
    if (this._pickMode) {
      this._finishPick([event.latlng.lat, event.latlng.lng]);
      return;
    }
    const hit = this._hitTest(event.containerPoint);
    if (!hit) return;
    this._tooltip.hidden = true;
    if (hit.type === 'business') {
      this._selectedId = hit.row.id;
      this._scheduleDraw();
      this.options.onSelectBusiness?.(hit.row);
    } else if (hit.type === 'cluster') {
      const zoom = this.map.getZoom();
      if (zoom >= 17) {
        this._selectedId = hit.cell.rows[0].id;
        this.options.onSelectBusiness?.(hit.cell.rows[0]);
        this._scheduleDraw();
      } else {
        const center = this.map.unproject([hit.cell.x, hit.cell.y], zoom);
        this.map.setView(center, Math.min(17, zoom + 1), { animate: true });
      }
    } else {
      this.options.onSelectArea?.({ center: hit.cell.center, radius: 2, label: 'Selected map area' });
    }
  }
}
