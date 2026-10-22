const LETTERS = ['A', 'B', 'C', 'D'];

chrome.storage.local.get('lastQuiz').then(({ lastQuiz }) => {
  if (!lastQuiz) {
    document.getElementById('questions').textContent = 'Nog geen quiz gemaakt. Neem eerst een aflevering op.';
    return;
  }
  render(lastQuiz);
});

function render({ datum, vragen, klas }) {
  const dag = datum ? ` (${datum})` : '';
  document.getElementById('sub').textContent = `${vragen.length} actua-vragen${dag} • Correcte antwoorden aangeduid`;
  document.getElementById('footer').textContent =
    ['Karrewiet Actua-Quiz', datum, `Klas ${klas ?? 6}`, 'Antwoordsleutel'].filter(Boolean).join(' • ');
  if (datum) document.title = `karrewiet_quiz_${datum.replace(/\s+/g, '_')}_antwoordsleutel`;

  const container = document.getElementById('questions');
  vragen.forEach((v, i) => {
    const q = document.createElement('div');
    q.className = 'q';

    const h = document.createElement('h2');
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = i + 1;
    const text = document.createElement('span');
    text.contentEditable = true;
    text.textContent = v.vraag;
    h.append(num, text);

    const opts = document.createElement('div');
    // Lange antwoorden onder elkaar, korte in twee kolommen, zoals in de voorbeelden
    opts.className = v.opties.some((o) => o.length > 28) ? 'opts long' : 'opts';
    v.opties.forEach((o, j) => {
      const opt = document.createElement('div');
      opt.className = j === v.juist ? 'opt ok' : 'opt';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.title = 'Markeer als juist antwoord';
      dot.addEventListener('click', () => mark(opts, opt));
      const label = document.createElement('span');
      label.contentEditable = true;
      label.textContent = `${LETTERS[j]}) ${o}${j === v.juist ? ' ✓' : ''}`;
      opt.append(dot, label);
      opts.append(opt);
    });

    q.append(h, opts);
    container.append(q);
  });
}

function mark(opts, chosen) {
  for (const opt of opts.children) {
    const label = opt.lastChild;
    label.textContent = label.textContent.replace(/ ✓$/, '');
    opt.classList.toggle('ok', opt === chosen);
    if (opt === chosen) label.textContent += ' ✓';
  }
}

document.getElementById('print').addEventListener('click', () => window.print());
