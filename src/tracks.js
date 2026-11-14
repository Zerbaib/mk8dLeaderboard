// The 96 Mario Kart 8 Deluxe tracks (base game + Booster Course Pass)
const CUPS = [
  ['Mushroom Cup', ['Mario Kart Stadium', 'Water Park', 'Sweet Sweet Canyon', 'Thwomp Ruins']],
  ['Flower Cup', ['Mario Circuit', 'Toad Harbor', 'Twisted Mansion', 'Shy Guy Falls']],
  ['Star Cup', ['Sunshine Airport', 'Dolphin Shoals', 'Electrodrome', 'Mount Wario']],
  ['Special Cup', ['Cloudtop Cruise', 'Bone-Dry Dunes', "Bowser's Castle", 'Rainbow Road']],
  ['Shell Cup', ['Wii Moo Moo Meadows', 'GBA Mario Circuit', 'DS Cheep Cheep Beach', "N64 Toad's Turnpike"]],
  ['Banana Cup', ['GCN Dry Dry Desert', 'SNES Donut Plains 3', 'N64 Royal Raceway', '3DS DK Jungle']],
  ['Leaf Cup', ['DS Wario Stadium', 'GCN Sherbet Land', '3DS Music Park', 'N64 Yoshi Valley']],
  ['Lightning Cup', ['DS Tick-Tock Clock', '3DS Piranha Plant Slide', 'Wii Grumble Volcano', 'N64 Rainbow Road']],
  ['Egg Cup', ['GCN Yoshi Circuit', 'Excitebike Arena', 'Dragon Driftway', 'Mute City']],
  ['Triforce Cup', ["Wii Wario's Gold Mine", 'SNES Rainbow Road', 'Ice Ice Outpost', 'Hyrule Circuit']],
  ['Crossing Cup', ['GCN Baby Park', 'GBA Cheese Land', 'Wild Woods', 'Animal Crossing']],
  ['Bell Cup', ['3DS Neo Bowser City', 'GBA Ribbon Road', 'Super Bell Subway', 'Big Blue']],
  ['Golden Dash Cup', ['Tour Paris Promenade', '3DS Toad Circuit', 'N64 Choco Mountain', 'Wii Coconut Mall']],
  ['Lucky Cat Cup', ['Tour Tokyo Blur', 'DS Shroom Ridge', 'GBA Sky Garden', 'Ninja Hideaway']],
  ['Turnip Cup', ['Tour New York Minute', 'SNES Mario Circuit 3', 'N64 Kalimari Desert', 'DS Waluigi Pinball']],
  ['Propeller Cup', ['Tour Sydney Sprint', 'GBA Snow Land', 'Wii Mushroom Gorge', 'Sky-High Sundae']],
  ['Rock Cup', ['Tour London Loop', 'GBA Boo Lake', '3DS Rock Rock Mountain', 'Wii Maple Treeway']],
  ['Moon Cup', ['Tour Berlin Byways', 'DS Peach Gardens', 'Merry Mountain', '3DS Rainbow Road']],
  ['Fruit Cup', ['Tour Amsterdam Drift', 'GBA Riverside Park', 'Wii DK Summit', "Yoshi's Island"]],
  ['Boomerang Cup', ['Tour Bangkok Rush', 'DS Mario Circuit', 'GCN Waluigi Stadium', 'Tour Singapore Speedway']],
  ['Feather Cup', ['Tour Athens Dash', 'GCN Daisy Cruiser', 'Wii Moonview Highway', 'Squeaky Clean Sprint']],
  ['Cherry Cup', ['Tour Los Angeles Laps', 'GBA Sunset Wilds', 'Wii Koopa Cape', 'Tour Vancouver Velocity']],
  ['Acorn Cup', ['Tour Rome Avanti', 'GCN DK Mountain', 'Wii Daisy Circuit', 'Piranha Plant Cove']],
  ['Spiny Cup', ['Tour Madrid Drive', "3DS Rosalina's Ice World", 'SNES Bowser Castle 3', 'Wii Rainbow Road']],
];

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const TRACKS = [];
CUPS.forEach(([cup, tracks], cupIndex) => {
  tracks.forEach((name) => {
    TRACKS.push({ id: slug(name), name, cup, cupIndex, dlc: cupIndex >= 12 });
  });
});

const TRACK_BY_ID = Object.fromEntries(TRACKS.map((t) => [t.id, t]));

module.exports = { TRACKS, TRACK_BY_ID, CUPS: CUPS.map(([c]) => c) };
