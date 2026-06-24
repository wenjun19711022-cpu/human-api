// FindMe Frontend App
// Replace with your actual app.js implementation

document.addEventListener('DOMContentLoaded', function() {
  const findBtn = document.getElementById('findBtn');
  const queryInput = document.getElementById('q');
  const resultsContainer = document.getElementById('results');
  const emptyMsg = document.getElementById('empty');
  const resultsHead = document.getElementById('resultsHead');

  // Placeholder implementation
  findBtn.addEventListener('click', async function() {
    const query = queryInput.value.trim();
    if (!query) return;

    resultsHead.textContent = 'Searching for candidates...';
    resultsContainer.innerHTML = '<p>Loading...</p>';
    emptyMsg.classList.add('hidden');

    try {
      const response = await fetch('/api/find', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, count: 6 })
      });
      const data = await response.json();
      displayResults(data);
    } catch (error) {
      console.error('Search error:', error);
      emptyMsg.classList.remove('hidden');
      resultsContainer.innerHTML = '';
    }
  });

  function displayResults(data) {
    if (!data || !data.candidates || data.candidates.length === 0) {
      emptyMsg.classList.remove('hidden');
      resultsContainer.innerHTML = '';
      resultsHead.textContent = '';
      return;
    }

    resultsHead.textContent = `Found ${data.candidates.length} candidates`;
    resultsContainer.innerHTML = data.candidates.map(candidate => `
      <div class="card">
        <div class="card-top">
          <div class="avatar">👤</div>
          <div style="flex:1">
            <div class="name">${candidate.name}<span class="vbadge">✓ Verified</span></div>
            <div class="headline">${candidate.headline || 'Professional'}</div>
          </div>
          <div class="statusdot"><span class="sd online"></span>Available</div>
        </div>
        <div class="matchrow">
          <span class="match">95% Match</span>
        </div>
        <div class="reasons">
          ${(candidate.reasons || []).map(r => `<span class="r">${r}</span>`).join('')}
        </div>
        <div class="cardbtns">
          <button class="btn-ghost">View Profile</button>
          <button class="btn-primary">Send Invite</button>
        </div>
      </div>
    `).join('');
  }
});
