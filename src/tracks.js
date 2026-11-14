// Liste des 96 circuits de Mario Kart 8 Deluxe (jeu de base + Pass circuits additionnels)
const CUPS = [
  ['Coupe Champignon', ['Mario Kart Stadium', 'Water Park', 'Sweet Sweet Canyon', 'Thwomp Ruins']],
  ['Coupe Fleur', ['Mario Circuit', 'Toad Harbor', 'Twisted Mansion', 'Shy Guy Falls']],
  ['Coupe Étoile', ['Sunshine Airport', 'Dolphin Shoals', 'Electrodrome', 'Mount Wario']],
  ['Coupe Spéciale', ['Cloudtop Cruise', 'Bone-Dry Dunes', "Bowser's Castle", 'Rainbow Road']],
  ['Coupe Carapace', ['Wii Moo Moo Meadows', 'GBA Mario Circuit', 'DS Cheep Cheep Beach', "N64 Toad's Turnpike"]],
  ['Coupe Banane', ['GCN Dry Dry Desert', 'SNES Donut Plains 3', 'N64 Royal Raceway', '3DS DK Jungle']],
  ['Coupe Feuille', ['DS Wario Stadium', 'GCN Sherbet Land', '3DS Music Park', 'N64 Yoshi Valley']],
  ['Coupe Éclair', ['DS Tick-Tock Clock', '3DS Piranha Plant Slide', 'Wii Grumble Volcano', 'N64 Rainbow Road']],
  ['Coupe Œuf', ['GCN Yoshi Circuit', 'Excitebike Arena', 'Dragon Driftway', 'Mute City']],
  ['Coupe Triforce', ["Wii Wario's Gold Mine", 'SNES Rainbow Road', 'Ice Ice Outpost', 'Hyrule Circuit']],
  ['Coupe Crossing', ['GCN Baby Park', 'GBA Cheese Land', 'Wild Woods', 'Animal Crossing']],
  ['Coupe Clochette', ['3DS Neo Bowser City', 'GBA Ribbon Road', 'Super Bell Subway', 'Big Blue']],
  ['Coupe Turbo Doré', ['Tour Paris Promenade', '3DS Toad Circuit', 'N64 Choco Mountain', 'Wii Coconut Mall']],
  ['Coupe Chat Chanceux', ['Tour Tokyo Blur', 'DS Shroom Ridge', 'GBA Sky Garden', 'Ninja Hideaway']],
  ['Coupe Navet', ['Tour New York Minute', 'SNES Mario Circuit 3', 'N64 Kalimari Desert', 'DS Waluigi Pinball']],
  ['Coupe Hélice', ['Tour Sydney Sprint', 'GBA Snow Land', 'Wii Mushroom Gorge', 'Sky-High Sundae']],
  ['Coupe Rocher', ['Tour London Loop', 'GBA Boo Lake', '3DS Rock Rock Mountain', 'Wii Maple Treeway']],
  ['Coupe Lune', ['Tour Berlin Byways', 'DS Peach Gardens', 'Merry Mountain', '3DS Rainbow Road']],
  ['Coupe Fruit', ['Tour Amsterdam Drift', 'GBA Riverside Park', 'Wii DK Summit', "Yoshi's Island"]],
  ['Coupe Boomerang', ['Tour Bangkok Rush', 'DS Mario Circuit', 'GCN Waluigi Stadium', 'Tour Singapore Speedway']],
  ['Coupe Plume', ['Tour Athens Dash', 'GCN Daisy Cruiser', 'Wii Moonview Highway', 'Squeaky Clean Sprint']],
  ['Coupe Cerise', ['Tour Los Angeles Laps', 'GBA Sunset Wilds', 'Wii Koopa Cape', 'Tour Vancouver Velocity']],
  ['Coupe Gland', ['Tour Rome Avanti', 'GCN DK Mountain', 'Wii Daisy Circuit', 'Piranha Plant Cove']],
  ['Coupe Épiny', ['Tour Madrid Drive', "3DS Rosalina's Ice World", 'SNES Bowser Castle 3', 'Wii Rainbow Road']],
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
