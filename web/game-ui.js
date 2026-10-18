/* Display local Stardew Valley sprites as UI panels. The source PNGs are read
 * from the user's installed game / Stardew Desk cache and are never committed.
 * Sprite coordinates follow Stardew Desk (SimoneScoop, MIT); see THIRD_PARTY.md. */
(() => {
  'use strict';
  // Pre-cropped by the local importer. WKWebView's file origin deliberately
  // prevents canvas pixel export, so use ordinary local image URLs instead.
  const assets = {panel:'panel',check:'check',checked:'checked',note:'note',wood:'wood','spring-icon':'spring-icon','month-icon':'month-icon','season-icon':'season-icon',harvest:'harvest',seedling:'seedling'};
  const load = name => new Promise((resolve,reject) => {const image=new Image();image.onload=resolve;image.onerror=reject;image.src=`game-assets/ui/${name}.png`;});
  Promise.all(Object.values(assets).map(load)).then(()=>{
    const style=document.documentElement.style;
    Object.entries(assets).forEach(([key,name])=>style.setProperty(`--game-${key}`,`url("game-assets/ui/${name}.png")`));
    document.body.classList.add('game-art');
    const status=document.getElementById('game-assets-status');if(status)status.textContent='已载入《星露谷物语》原版贴图';
  }).catch(()=>{const status=document.getElementById('game-assets-status');if(status)status.textContent='未找到素材：运行 scripts/import-game-assets.sh 后重新打包';});
})();
