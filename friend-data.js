/* Friend copy only (loaded after data.js): friends take Tamil, French or Hindi, so that subject is
   "Second language" here; and some take English as a Second Language, so the model exam lists ESL too. */
(() => {
  const sl = SUBJECTS.find((s) => s.id === 'tamil');
  sl.name = 'Second language';
  sl.code = 'SL';
  sl.inline = 'the second language';

  const own = SCHOOL_EXAMS.filter((x) => x.s !== 'tamil' && x.s !== 'eng');
  const shared = [
    { date: '2026-11-02', at: '09:00', s: 'eng', p: 'p1', title: 'Paper 1 (FLE or ESL)', short: 'P1', time: '9:00–11:00 am', dur: '2h' },
    { date: '2026-11-03', at: '09:00', s: 'tamil', p: 'p1', title: 'Tamil', short: '', time: 'Paper 1 9:00–11:00 am, Paper 2 11:15 am–1:15 pm' },
    { date: '2026-11-03', at: '09:00', s: 'tamil', p: 'p1', title: 'French', short: '', time: 'Paper 2 9:00–10:00 am, Paper 4 10:15–11:15 am, Paper 1 11:45 am–12:30 pm' },
    { date: '2026-11-03', at: '09:00', s: 'tamil', p: 'p1', title: 'Hindi', short: '', time: 'Paper 1 9:00–11:00 am, Paper 2 11:15 am–12 noon' },
    { date: '2026-11-10', at: '12:30', s: 'eng', p: 'p2', title: 'FLE Paper 2', short: 'FLE P2', time: '12:30–2:30 pm', dur: '2h' },
    { date: '2026-11-10', at: '13:30', s: 'eng', p: 'p2', title: 'ESL Listening', short: 'ESL Listening', time: '1:30–2:30 pm', dur: '1h' },
  ];
  const all = own.concat(shared).sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
  SCHOOL_EXAMS.splice(0, SCHOOL_EXAMS.length, ...all);
})();

/* Tamil Paper 1 is split into its seven questions on the main copy; here the subject also covers
   French and Hindi, whose papers are laid out differently, so it stays one paper. */
delete PAPER_PARTS.tamil_p1;
