export async function renderRoster({
  root = document.getElementById('char-list'),
  rosterUrl = '/data/roster.json',
  onSelect = (character) => console.log('Selected fighter:', character.id)
} = {}) {
  if (!root) throw new Error('Character select root #char-list was not found.');
  root.replaceChildren();

  const response = await fetch(rosterUrl);
  if (!response.ok) throw new Error(`Could not load roster (${response.status}).`);
  const roster = await response.json();

  for (const character of roster) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fighter-card';
    button.dataset.characterId = character.id;

    const name = document.createElement('strong');
    name.textContent = character.name;
    const playstyle = document.createElement('span');
    playstyle.textContent = character.playstyle || character.archetype || 'Fighter';

    button.append(name, playstyle);
    button.addEventListener('click', () => onSelect(character));
    root.append(button);
  }
  return roster;
}
