// The admin panel's styles (design.md "Panel style"): Home Assistant's own look,
// from its theme variables, so it follows light and dark. One radius, one
// spacing scale (4/8/12/16/24), one type scale (22/16/14/12), 36px buttons and
// 40px fields everywhere. No gradients, no glyphs: icons are <ha-icon>.

// A chevron for every dropdown, grey enough for light and dark themes.
const CHEVRON = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath fill='%23888' d='M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z'/%3E%3C/svg%3E\")";

export const CSS = `
  :host { display: block; min-height: 100vh; background: var(--primary-background-color); color: var(--primary-text-color);
          font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, Roboto, sans-serif)); font-size: 14px; line-height: 1.45;
          --radius: var(--ha-card-border-radius, 12px); --r-sm: 8px;
          --line: var(--divider-color, rgba(127,127,127,.25)); --edge: var(--outline-color, rgba(127,127,127,.45));
          --card: var(--card-background-color, #fff); --soft: var(--secondary-background-color, rgba(127,127,127,.08));
          --muted: var(--secondary-text-color); --accent: var(--primary-color); --on-accent: var(--text-primary-color, #fff);
          --bad: var(--error-color, #db4437); --ok: var(--success-color, #43a047); --warn-c: var(--warning-color, #ffa600);
          --hover: rgba(127,127,127,.08); --sel: rgba(var(--rgb-primary-color, 3,169,244), .12); }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  ha-icon { --mdc-icon-size: 20px; display: inline-flex; flex: none; }

  /* ---------------------------------------------------------- header */
  .top { position: sticky; top: 0; z-index: 4; display: flex; align-items: center; gap: 12px; padding: 0 12px 0 4px; height: 56px;
         background: var(--app-header-background-color, var(--primary-color)); color: var(--app-header-text-color, #fff);
         border-bottom: var(--app-header-border-bottom, none); }
  .menu:empty { width: 8px; }
  .title { font-size: 20px; font-weight: 400; white-space: nowrap; }
  .status { flex: 1; display: flex; gap: 12px; align-items: center; overflow: hidden; white-space: nowrap; font-size: 13px; min-width: 0; }
  .status .now { opacity: .85; overflow: hidden; text-overflow: ellipsis; }
  .status .flash { font-weight: 500; }
  .top .flat { color: inherit; border-color: currentColor; background: none; }
  .top .flat.on { background: rgba(255,255,255,.16); }

  /* ---------------------------------------------------------- page: menu, body, dock */
  .page { display: grid; grid-template-columns: 232px minmax(0, 1fr) 280px; gap: 24px; align-items: start;
          max-width: 1680px; margin: 0 auto; padding: 16px 24px 96px 12px; }
  .page.nodock { grid-template-columns: 232px minmax(0, 1fr); }
  .page.nodock .dock { display: none; }
  .nav { position: sticky; top: 72px; }
  .nav .links { display: flex; flex-direction: column; gap: 2px; }
  .nav button { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; border: 0; background: none;
                color: var(--primary-text-color); font: inherit; cursor: pointer; border-radius: var(--r-sm); }
  .nav .sec { padding: 0 12px; height: 40px; font-weight: 500; }
  .nav .sec ha-icon { color: var(--muted); }
  .nav .sub { padding: 0 12px 0 44px; height: 34px; color: var(--muted); }
  .nav button:hover { background: var(--hover); }
  .nav button.on { background: var(--sel); color: var(--accent); }
  .nav .sec.on ha-icon, .nav .sec.here ha-icon { color: var(--accent); }
  .navpick { display: none; }
  main.body { container: main / inline-size; min-width: 0; }
  .dock { position: sticky; top: 72px; }

  /* ---------------------------------------------------------- type */
  .ptitle { display: flex; align-items: center; gap: 12px; min-height: 40px; margin: 0 0 8px; }
  h1 { flex: 1; margin: 0; font-size: 22px; font-weight: 400; }
  h2 { margin: 0; font-size: 18px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  h3 { margin: 24px 0 12px; font-size: 16px; font-weight: 500; }
  h3:first-child { margin-top: 0; }
  h4 { margin: 16px 0 8px; font-size: 14px; font-weight: 500; }
  p { margin: 8px 0; }
  small { display: block; font-size: 12px; margin-top: 4px; color: var(--muted); line-height: 1.35; }
  .muted { color: var(--muted); }
  code { font-family: var(--code-font-family, monospace); font-size: 12px; }
  .intro { margin: 0 0 16px; color: var(--muted); max-width: 760px; }
  .intro p { margin: 0; }
  details.learn summary { cursor: pointer; color: var(--accent); margin-top: 4px; font-size: 13px; width: fit-content; }
  details.learn > div { margin-top: 8px; padding: 8px 12px; border-left: 3px solid var(--line); }
  .empty { color: var(--muted); padding: 24px 16px; text-align: center; margin: 0; }
  .grow { flex: 1; }

  /* ---------------------------------------------------------- cards and groups */
  .card, .group, .footer { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; margin: 0 0 16px; }
  .body > .group > h3, .card > h3:first-child { margin: 0 0 16px; }
  /* inside an editor a group is a titled block, not a card in a card */
  .detail .group, .item .group { background: none; border: 0; border-radius: 0; padding: 0; margin: 0 0 24px; }
  .detail .group > h3, .item .group > h3 { margin: 0 0 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
  .grid > .wide, .grid > .check.wide, .grid > table, .grid > .chips, .grid > h3, .grid > h4 { grid-column: 1 / -1; }
  .footer { display: flex; gap: 8px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; margin: 0 0 16px; align-items: start; }
  .cards > .card { margin: 0; }
  .card > small:last-child { margin-top: 12px; }
  .colour { flex-wrap: nowrap; margin: 0; gap: 8px; }
  .colour > input.swatch { flex: none; width: 44px; min-width: 0; }
  .cards-title { margin: 24px 0 12px; }
  .combine { margin: 0 0 16px; }

  /* ---------------------------------------------------------- fields: one outlined style */
  input, select, textarea { font: inherit; font-size: 14px; color: var(--primary-text-color); background: var(--card);
         border: 1px solid var(--edge); border-radius: var(--r-sm); padding: 0 12px; height: 40px; min-width: 0; width: 100%; }
  textarea { height: auto; padding: 10px 12px; }
  input:hover, select:hover, textarea:hover { border-color: var(--primary-text-color); }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  input:disabled, select:disabled { opacity: .5; }
  select { appearance: none; -webkit-appearance: none; padding-right: 36px; cursor: pointer;
           background-image: ${CHEVRON}; background-repeat: no-repeat; background-position: right 8px center; background-size: 22px; }
  input[type=range] { height: 24px; padding: 0; accent-color: var(--accent); background: none; border: 0; box-shadow: none; }
  input[type=radio], input[type=checkbox]:not(.switch) { width: 18px; height: 18px; padding: 0; accent-color: var(--accent); flex: none; }
  input[type=color], input.swatch { width: 44px; padding: 3px; flex: none; cursor: pointer; }
  .field { position: relative; display: flex; flex-direction: column; min-width: 0; }
  .field > span:first-child { font-size: 12px; font-weight: 500; color: var(--muted); margin: 0 0 6px; }
  /* the label sits in the field's top border when the field is one box */
  .field:has(> input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=color]), > select, > .unit) { padding-top: 7px; }
  .field:has(> input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=color]), > select, > .unit) > span:first-child {
    position: absolute; top: 0; left: 9px; z-index: 1; margin: 0; padding: 0 4px; line-height: 14px; background: var(--card);
    max-width: calc(100% - 24px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; pointer-events: none; }
  .field:focus-within > span:first-child { color: var(--accent); }
  .unit { display: flex; align-items: center; position: relative; }
  .unit input { padding-right: 40px; }
  .unit > span { position: absolute; right: 12px; color: var(--muted); pointer-events: none; }
  .req { color: var(--bad); }

  /* a switch row: the words left, the switch right */
  .check { display: flex; gap: 16px; align-items: center; justify-content: space-between; cursor: pointer; padding: 4px 0; min-height: 40px; }
  .check > input.switch { order: 2; }
  .check > span { flex: 1; }
  .check b { font-weight: 400; }
  input.switch { appearance: none; -webkit-appearance: none; flex: none; width: 36px; height: 14px; padding: 0; margin: 0 4px; border-radius: 7px;
         background: var(--switch-unchecked-track-color, rgba(127,127,127,.5)); border: 0; position: relative; cursor: pointer; box-shadow: none; overflow: visible; }
  input.switch::after { content: ""; position: absolute; top: -3px; left: -4px; width: 20px; height: 20px; border-radius: 50%;
         background: var(--switch-unchecked-button-color, #fafafa); box-shadow: 0 1px 3px rgba(0,0,0,.4); transition: left .15s; }
  input.switch:checked { background: var(--switch-checked-track-color, var(--accent)); opacity: 1; }
  input.switch:checked::after { left: 20px; background: var(--switch-checked-button-color, var(--accent)); }
  input.switch:hover { border: 0; }
  input.switch:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; box-shadow: none; }

  details.more { margin: 8px 0 0; }
  details.more > summary { cursor: pointer; color: var(--accent); font-weight: 500; padding: 8px 0; list-style: none; width: fit-content;
                           display: flex; align-items: center; gap: 4px; }
  details.more > summary::-webkit-details-marker { display: none; }
  details.more > summary::before { content: ""; width: 8px; height: 8px; border: solid currentColor; border-width: 0 2px 2px 0;
                                   transform: rotate(-45deg); margin: 0 6px 0 2px; transition: transform .15s; }
  details.more[open] > summary::before { transform: rotate(45deg); margin-top: -4px; }
  details.more > .grid { margin: 12px 0 4px; }

  /* ---------------------------------------------------------- buttons */
  button { font: inherit; cursor: pointer; }
  button:disabled { opacity: .45; cursor: default; }
  .autosnip { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 12px; margin: -6px 0 8px; }
  .autosnip code { font-size: 12px; } .autosnip .flat { height: 28px; padding: 0 10px; }
  .primary, .flat { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 36px; padding: 0 16px;
                    border-radius: 18px; font-weight: 500; font-size: 14px; white-space: nowrap; flex: none; }
  .primary { background: var(--accent); color: var(--on-accent); border: 1px solid var(--accent); }
  .primary:hover:not(:disabled) { filter: brightness(1.08); }
  .flat { background: var(--card); color: var(--primary-text-color); border: 1px solid var(--edge); }
  .flat:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .flat.danger { color: var(--bad); border-color: var(--bad); }
  .flat.danger:hover:not(:disabled) { background: rgba(219,68,55,.08); color: var(--bad); }
  .primary ha-icon, .flat ha-icon { --mdc-icon-size: 18px; margin-left: -4px; }
  .icon { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; flex: none;
          border: 0; border-radius: 50%; background: none; color: var(--muted); }
  .icon:hover:not(:disabled) { background: var(--hover); color: var(--primary-text-color); }
  button.link { background: none; border: 0; padding: 0; color: var(--accent); font: inherit; text-decoration: underline; }
  .add { width: 100%; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 4px 0; }
  .row > input, .row > select { width: auto; flex: 1; min-width: 140px; }
  .row .grow { min-width: 160px; }
  .addrow { flex-wrap: nowrap; margin: 0; } .addrow select { flex: 1; min-width: 0; } .addrow .add { width: auto; }

  /* segmented control */
  .seg { display: inline-flex; border: 1px solid var(--edge); border-radius: 18px; overflow: hidden; flex-wrap: wrap; }
  .seg button { border: 0; background: none; height: 34px; padding: 0 16px; color: var(--primary-text-color); font-weight: 500; }
  .seg button + button { border-left: 1px solid var(--edge); }
  .seg button:hover:not(.on) { background: var(--hover); }
  .seg button.on { background: var(--sel); color: var(--accent); }

  /* chips and badges */
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0; }
  .chip { display: inline-flex; align-items: center; height: 24px; border: 1px solid var(--edge); background: none; color: var(--primary-text-color);
          padding: 0 10px; border-radius: 12px; font-size: 12px; white-space: nowrap; }
  .chip.bad { border-color: var(--bad); color: var(--bad); }
  .chip.good { border-color: var(--ok); color: var(--ok); }
  .chip.critical { background: var(--bad); color: #fff; border-color: var(--bad); }
  .chip.major { color: var(--warn-c); border-color: var(--warn-c); }
  .chip.pick { cursor: pointer; height: 32px; padding: 0 12px; font-size: 13px; border-radius: 16px; }
  .chip.pick:hover { border-color: var(--accent); }
  .chip.pick.on { background: var(--sel); color: var(--accent); border-color: var(--accent); }
  .badge { display: inline-flex; align-items: center; height: 22px; font-size: 12px; padding: 0 8px; border-radius: 11px;
           background: var(--soft); color: var(--muted); white-space: nowrap; }
  .badge.bad { background: rgba(219,68,55,.14); color: var(--bad); } .badge.good { background: rgba(67,160,71,.14); color: var(--ok); }
  .badge.off { opacity: .6; }
  .ent { display: inline-flex; align-items: center; gap: 2px; height: 32px; max-width: 100%; min-width: 0; background: var(--soft); border-radius: 16px; padding: 0 2px 0 12px; }
  .ent code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .ent .icon { width: 28px; height: 28px; } .ent ha-icon { --mdc-icon-size: 16px; }

  /* ---------------------------------------------------------- list + detail */
  .ld { display: grid; grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); gap: 16px; align-items: start; container-type: inline-size; }
  .ld-list { position: sticky; top: 72px; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
  .ld-add { padding: 12px; border-bottom: 1px solid var(--line); }
  .ld-items { max-height: calc(100vh - 220px); overflow-y: auto; }
  .ld-detail { min-width: 0; container-type: inline-size; }
  .ld-detail > .detail, .item.open > .detail { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); }
  .ld-none { color: var(--muted); padding: 48px 16px; text-align: center; border: 1px dashed var(--line); border-radius: var(--radius); margin: 0; }
  .item + .item { border-top: 1px solid var(--line); }
  .item .head { display: flex; align-items: center; gap: 8px; padding: 0 4px 0 12px; min-height: 60px; position: relative; }
  .item .head:hover { background: var(--hover); }
  .item .head.on { background: var(--sel); }
  .item .head.on::before { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 0 3px 3px 0; background: var(--accent); }
  .item .name { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; align-self: stretch; justify-content: center;
                background: none; border: 0; padding: 8px 0; text-align: left; color: var(--primary-text-color); font: inherit; overflow: hidden; }
  .item .name b { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item .summary { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item .tags { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
  .item .tags:empty { display: none; }
  .item .head .badge { max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
  /* in a row only a live state worth seeing: active, or fired */
  .item .head .badge:not(.bad):not(.good) { display: none; }
  .item .chev { color: var(--muted); display: flex; }
  .ld .item .chev { display: none; }
  .detail { min-width: 0; }
  .dhead { display: flex; align-items: center; gap: 8px; min-height: 61px; padding: 8px 12px 8px 20px; border-bottom: 1px solid var(--line); }
  .dhead h2 { flex: 1; min-width: 0; }
  .dhead .back { display: none; margin-left: -8px; }
  .detail > .body { padding: 20px; }
  .detail > .foot { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 12px 20px; border-top: 1px solid var(--line); }
  /* an item outside a list (a rotation's steps, a story's steps) opens in place */
  .item:not(.ld *) { border: 1px solid var(--line); border-radius: var(--radius); background: var(--card); margin: 0 0 8px; }
  .item:not(.ld *) + .item:not(.ld *) { border-top: 1px solid var(--line); }
  .item.open:not(.ld *) > .detail { border: 0; border-top: 1px solid var(--line); border-radius: 0; }
  .item.open:not(.ld *) > .detail .dhead { display: none; }

  /* ---------------------------------------------------------- tables, notes, errors */
  table.matches { width: 100%; border-collapse: collapse; font-size: 13px; margin: 8px 0 4px; }
  .matches td { padding: 8px; border-top: 1px solid var(--line); }
  .matches tr.pass td:first-child { color: var(--accent); }
  .draft-mood { margin: 0 0 16px; padding: 12px 16px; border-radius: var(--radius); background: var(--card); border: 1px solid var(--line); }
  .draft-mood:empty { display: none; }
  .error { background: rgba(219,68,55,.08); border: 1px solid var(--bad); border-radius: var(--r-sm); padding: 12px 16px; margin: 0 0 16px; }
  .error ul { margin: 4px 0 0; padding-left: 20px; }
  .errors:empty { display: none; }
  .bad { color: var(--bad); } .good { color: var(--ok); }
  .note { margin: 4px 0; padding: 8px 12px; border-left: 3px solid var(--warn-c); background: var(--soft);
          color: var(--primary-text-color); font-size: 12px; border-radius: 4px; }

  /* ---------------------------------------------------------- save bar */
  .savebar { position: fixed; z-index: 5; left: 50%; transform: translateX(-50%); bottom: 16px;
             display: flex; align-items: center; gap: 12px; width: min(640px, calc(100vw - 32px)); padding: 10px 12px 10px 20px;
             background: var(--card); border: 1px solid var(--edge); border-radius: 28px;
             box-shadow: var(--ha-card-box-shadow, 0 2px 12px rgba(0,0,0,.25)), 0 4px 16px rgba(0,0,0,.18); }
  .savebar .msg { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* ---------------------------------------------------------- Alfie, sliders, previews */
  .dcard { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 8px 12px 12px; }
  .dock-head { display: flex; align-items: center; gap: 8px; margin: 0 -4px 4px 4px; }
  .dock-note { margin: 8px 4px 0; }
  .split { display: grid; grid-template-columns: 1fr 300px; gap: 24px; align-items: start; }
  .live { position: sticky; top: 72px; }
  .dock alfie-card, .live alfie-card, .face alfie-card, .pvbox alfie-card, .minis alfie-card { display: block; background: #000; border-radius: var(--r-sm); overflow: hidden; }
  .sliders { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px 32px; }
  .slider { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 4px 12px; }
  .slider > span { grid-column: 1 / -1; }
  .slider output { min-width: 40px; text-align: right; color: var(--primary-text-color); font-variant-numeric: tabular-nums; }
  .slider b { font-weight: 500; }
  .opt .row { margin: 0; }
  .tools { display: flex; align-items: center; margin-left: auto; }
  .steps .step, .rsteps > .row { margin: 0; padding: 8px 0; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .steps, .rsteps { margin: 0 0 12px; border-top: 1px solid var(--line); }
  .detail .body > h3, .detail .body > h4 { margin-top: 24px; }
  @container (max-width: 720px) {
    .split, .ld-detail .split2 { grid-template-columns: 1fr; }
    .live, .ld-detail .pvbox { position: static; max-width: 320px; }
  }

  /* ---------------------------------------------------------- widths */
  @media (max-width: 1800px) {
    .page, .page.nodock { grid-template-columns: 220px minmax(0, 1fr); }
    .dock { position: fixed; z-index: 6; right: 16px; bottom: 16px; top: auto; width: 220px; max-height: calc(100vh - 88px); overflow-y: auto;
            box-shadow: 0 4px 24px rgba(0,0,0,.3); border-radius: var(--radius); }
    .page.saving .dock { bottom: 84px; }
  }
  @media (max-width: 1280px) {
    .page, .page.nodock { grid-template-columns: minmax(0, 1fr); padding: 12px 16px 96px; gap: 12px; }
    .nav { position: static; } .nav .links { display: none; } .navpick { display: block; max-width: 420px; }
  }
  @media (max-width: 870px) {
    .page, .page.nodock { padding: 12px 12px 96px; }
    .status .now { display: none; } .title { font-size: 18px; }
    .alfie-toggle span { display: none; }
    .dock { width: 200px; }
  }
  /* a narrow page body: the list, then the open item's editor in its place */
  @container main (max-width: 759px) {
    .ld { grid-template-columns: minmax(0, 1fr); }
    .ld-list { position: static; } .ld-items { max-height: none; }
    .ld.has-open .ld-list, .ld:not(.has-open) .ld-detail { display: none; }
    .dhead .back { display: inline-flex; }
  }
`;
