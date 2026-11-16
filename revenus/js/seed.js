// Historique repris du fichier Excel « benef montage video » (mai 2025 → sept. 2026).
// Format compact : [date, client, clientFinal, type, projet, montant €, statut, déclaré € | null, tranche, note, àVérifier]
// déclaré = null signifie « tout le montant est déclaré ».
// L'URL des factures n'était pas lisible dans l'export PDF : à recoller à la main.

const P = 'paid', U = 'unpaid';

const ROWS = [
  // 2025
  ['2025-05-01', 'Swivo', '', 'VSL', '', 150, P, null, '', ''],
  ['2025-05-06', 'Swivo', '', 'Logo animation', '', 45, P, null, '', ''],
  ['2025-05-12', 'Swivo', '', 'Logo animation', '', 45, P, null, '', ''],
  ['2025-06-26', 'Swivo', '', 'Logo animation', '', 45, P, null, '', 'Ligne recopiée aussi dans l’onglet de juillet : importée une seule fois.', true],
  ['2025-06-20', 'Hooked', '', 'VSL', 'Leadminer', 700, U, null, '', 'Jamais payé.'],
  ['2025-07-17', 'Swivo', '', 'Logo animation', '', 45, P, null, '', ''],
  ['2025-07-24', 'Swivo', '', 'Logo animation', '', 45, P, null, '', ''],
  ['2025-09-10', 'Swivo', '', 'Logo animation', '', 45, P, null, '', ''],
  ['2025-09-15', 'Swivo', '', 'Reel / Short', '', 200, P, null, '', ''],
  ['2025-09-18', 'Ecom Club', '', 'Logo animation', '', 100, P, null, '', '2 animations.'],
  ['2025-09-18', 'Ecom Club', '', 'VSL', '', 80, P, null, '', ''],
  ['2025-10-04', 'Ecom Club', '', 'Ads content', '', 152, P, null, '', ''],
  ['2025-10-14', 'Swivo', '', 'Logo animation', '', 45, P, null, '', ''],
  ['2025-10-21', 'Wenoble', '', 'Montage vlog', '', 170, P, null, '', ''],
  ['2025-10-29', 'Vizionary', 'Deep IP', 'VSL motion', '', 400, P, null, '1/2', ''],
  ['2025-12-08', 'Vizionary', 'Deep IP', 'VSL motion', '', 400, P, null, '2/2', ''],
  ['2025-12-09', 'Vizionary', 'PPC Assist', 'VSL motion', '', 400, P, null, '1/2', ''],
  ['2025-12-10', 'Wenoble', '', 'Commission', '', 69, P, null, '', ''],
  ['2025-12-23', 'CE Finan', '', 'VSL motion', '', 500, P, null, '1/2', ''],
  // 2026
  ['2026-01-10', 'Wenoble', '', 'Commission', '', 59.38, P, null, '', ''],
  ['2026-01-21', 'Vizionary', 'PPC Assist', 'VSL', '', 400, P, null, '', 'Client noté « PPC ASSIST » seul dans l’Excel.', true],
  ['2026-01-25', 'Vizionary', '', 'VSL', '', 400, P, null, '', '400 € sur 600 €.'],
  ['2026-01-27', 'Watchpoint', '', 'VSL', '', 390, P, 250, '2/2', '50 % restant + frais de retours.'],
  ['2026-02-01', 'Ecom Club', '', 'Reel / Short', '', 200, P, 0, '', ''],
  ['2026-02-11', 'Vizionary', '', 'VSL', '60 s', 1100, P, 550, '', ''],
  ['2026-03-12', 'Vizionary', 'Carsafe', 'Storyboard', 'Carsafe', 300, P, null, '', 'Note Excel : « jsp » pour la déclaration.', true],
  ['2026-03-15', 'Swivo', '', 'Logo animation', 'Logo papa', 290, P, 0, '', 'Ami proche.'],
  ['2026-04-08', 'Vizionary', 'Carsafe', 'Motion design', 'Carsafe', 650, P, null, '', 'Animation + retours. Date Excel : 08/03/2026, dans l’onglet d’avril.', true],
  ['2026-04-09', 'Ecom Club', '', 'Retours', '', 45, P, 0, '', 'Date Excel : 09/03/2026, dans l’onglet d’avril.', true],
  ['2026-04-10', 'Vizionary', 'Carsafe', 'Retours', 'Carsafe', 80, P, 0, '', 'Date Excel : 10/03/2026, dans l’onglet d’avril.', true],
  ['2026-04-20', 'Vizionary', 'Heevi', 'Motion design', 'Heevi 45 s', 400, P, null, '1/2', ''],
  ['2026-05-12', 'Vizionary', 'Heevi', 'Motion design', 'Heevi 45 s', 200, P, null, '2/2', ''],
  ['2026-05-13', 'Vizionary', 'Heevi', 'Motion design', 'Heevi 1 min 15', 400, P, null, '1/2', ''],
  ['2026-05-22', 'Vizionary', 'Heevi', 'Motion design', 'Heevi 1 min 15', 400, P, null, '2/2', ''],
  ['2026-05-29', 'Vizionary', 'Clickway', 'Motion design', 'Clickway 30 s', 450, P, null, '', ''],
  ['2026-06-02', 'Clément', '', 'Apport d’affaires', '', 70, P, 0, '', 'Pas de facture.'],
  ['2026-06-05', 'Vizionary', 'PPC Assist', 'Motion design', 'PPC Assist 30 s', 200, P, null, '1/2', ''],
  ['2026-07-05', 'Vizionary', 'PPC Assist', 'Motion design', 'PPC Assist 30 s', 200, P, null, '2/2', 'Date Excel : 05/06/2026, dans l’onglet de juillet.', true],
  ['2026-07-16', 'Vizionary', 'Interhuman', 'Montage vidéo', 'Vidéo asset', 200, P, 0, '', ''],
  ['2026-08-04', 'Vizionary', 'PPC Assist', 'Motion design', 'PPC intro 6 s', 75, P, null, '', ''],
  ['2026-09-18', 'Motion Lab', '', 'Motion design', 'Synthetiz 60 s', 350, P, null, '1/2', ''],
  ['2026-09-18', 'Motion Lab', '', 'Motion design', 'Synthetiz 60 s', 350, P, null, '2/2', 'Même date que le 1/2 dans l’Excel, onglet suivant.', true],
  ['2026-09-18', 'Motion Lab', '', 'Motion design', 'Passio 30 s', 200, P, null, '1/2', 'Même date que Synthetiz dans l’Excel, onglet suivant.', true],
];

export function seedEntries() {
  const stamp = '2026-01-01T00:00:00.000Z';
  return ROWS.map((r, i) => ({
    id: `seed-${String(i + 1).padStart(3, '0')}`,
    date: r[0],
    client: r[1],
    endClient: r[2],
    type: r[3],
    project: r[4],
    amount: Math.round(r[5] * 100),
    status: r[6],
    declared: r[7] == null ? null : Math.round(r[7] * 100),
    installment: r[8],
    notes: r[9],
    review: Boolean(r[10]),
    invoiceUrl: '',
    createdAt: stamp,
    updatedAt: stamp,
    deleted: false,
  }));
}
