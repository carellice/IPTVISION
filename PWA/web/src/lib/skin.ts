// Graphic style of this browser: the current one or skeuomorphic (styles.css, html[data-skin="skeuo"]).
const KEY = 'iptvision.skin'

export function applySkin() {
  try { if (localStorage.getItem(KEY) === 'skeuo') document.documentElement.dataset.skin = 'skeuo' } catch { /* private mode */ }
}

export const isSkeuo = () => document.documentElement.dataset.skin === 'skeuo'

export function setSkeuo(on: boolean) {
  if (on) document.documentElement.dataset.skin = 'skeuo'
  else delete document.documentElement.dataset.skin
  try { localStorage.setItem(KEY, on ? 'skeuo' : 'classic') } catch { /* private mode */ }
}
