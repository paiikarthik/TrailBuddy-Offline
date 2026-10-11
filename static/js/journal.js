/**
 * static/js/journal.js - Privacy-First Local Nature Journal.
 *
 * Keeps all observations 100% in the user's browser.
 * Zero tracking, zero cloud transmission. Supports full CRUD, search, filter,
 * and JSON import/export backup.
 */

const JournalManager = (() => {
  const STORAGE_KEY = 'trailbuddy_nature_journal_v1';
  let entries = [];
  let editingEntryId = null;

  function init() {
    loadEntries();
    setupEventListeners();
    renderJournalList();
  }

  function loadEntries() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        entries = JSON.parse(data);
        if (!Array.isArray(entries)) entries = [];
      } else {
        // Sample welcome entry for first-time users
        entries = [
          {
            id: 'sample-entry-01',
            title: 'First Step Outside: Touch Grass Moment',
            notes: 'Took a quiet morning walk around the neighborhood park. Noticed the early autumn breeze rustling the sycamore leaves and smelled damp earth after last night\'s rain. Felt surprisingly refreshing to leave the phone on my desk.',
            date: new Date().toISOString().split('T')[0],
            location: 'Neighborhood Green Belt (Demo Entry)',
            environment: 'park',
            mood: 'breezy',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        ];
        saveToStorage();
      }
    } catch (e) {
      console.error('Error loading journal entries:', e);
      entries = [];
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
      updateJournalSummary();
    } catch (e) {
      showToast('Storage quota exceeded. Please export backup and clear old entries.', 'error');
    }
  }

  function setupEventListeners() {
    const form = document.getElementById('journal-form');
    if (form) {
      form.addEventListener('submit', handleFormSubmit);
    }

    const cancelBtn = document.getElementById('btn-cancel-edit');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', resetForm);
    }

    const searchInput = document.getElementById('journal-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => renderJournalList());
    }

    const filterEnv = document.getElementById('journal-filter-env');
    if (filterEnv) {
      filterEnv.addEventListener('change', () => renderJournalList());
    }

    const exportBtn = document.getElementById('btn-export-journal');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportBackup);
    }

    const importInput = document.getElementById('import-file-input');
    if (importInput) {
      importInput.addEventListener('change', handleImportBackup);
    }
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    const title = document.getElementById('journal-title').value.trim();
    const notes = document.getElementById('journal-notes').value.trim();
    const location = document.getElementById('journal-location').value.trim() || 'Nature';
    const date = document.getElementById('journal-date').value || new Date().toISOString().split('T')[0];
    const environment = document.getElementById('journal-environment').value || 'park';
    const mood = document.getElementById('journal-mood').value || 'peaceful';

    if (!title || !notes) {
      showToast('Please provide both a title and reflection notes.', 'warning');
      return;
    }

    if (editingEntryId) {
      // Update existing entry
      const index = entries.findIndex(item => item.id === editingEntryId);
      if (index !== -1) {
        entries[index] = {
          ...entries[index],
          title,
          notes,
          location,
          date,
          environment,
          mood,
          updated_at: new Date().toISOString()
        };
        showToast('Journal observation updated.', 'success');
      }
      editingEntryId = null;
    } else {
      // Create new entry
      const newEntry = {
        id: 'entry-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
        title,
        notes,
        location,
        date,
        environment,
        mood,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      entries.unshift(newEntry);
      showToast('Nature observation saved locally in your browser!', 'success');
    }

    saveToStorage();
    resetForm();
    renderJournalList();

    // Trigger dashboard summary update if available
    if (window.TrailBuddyApp && window.TrailBuddyApp.updateDashboardStats) {
      window.TrailBuddyApp.updateDashboardStats();
    }
  }

  function resetForm() {
    const form = document.getElementById('journal-form');
    if (form) form.reset();
    document.getElementById('journal-date').value = new Date().toISOString().split('T')[0];
    editingEntryId = null;

    const cancelBtn = document.getElementById('btn-cancel-edit');
    const submitBtn = document.getElementById('journal-submit-btn');
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (submitBtn) submitBtn.textContent = 'Save Observation';
  }

  function editEntry(id) {
    const entry = entries.find(item => item.id === id);
    if (!entry) return;

    editingEntryId = id;
    document.getElementById('journal-title').value = entry.title;
    document.getElementById('journal-notes').value = entry.notes;
    document.getElementById('journal-location').value = entry.location || '';
    document.getElementById('journal-date').value = entry.date;
    document.getElementById('journal-environment').value = entry.environment || 'park';
    document.getElementById('journal-mood').value = entry.mood || 'peaceful';

    const cancelBtn = document.getElementById('btn-cancel-edit');
    const submitBtn = document.getElementById('journal-submit-btn');
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    if (submitBtn) submitBtn.textContent = 'Update Observation';

    // Scroll smoothly to form
    document.getElementById('journal-form-card').scrollIntoView({ behavior: 'smooth' });
  }

  function deleteEntry(id) {
    if (!confirm('Are you sure you want to delete this nature observation? This cannot be undone.')) {
      return;
    }
    entries = entries.filter(item => item.id !== id);
    saveToStorage();
    renderJournalList();
    showToast('Entry deleted.', 'info');

    if (window.TrailBuddyApp && window.TrailBuddyApp.updateDashboardStats) {
      window.TrailBuddyApp.updateDashboardStats();
    }
  }

  function renderJournalList() {
    const listContainer = document.getElementById('journal-list');
    if (!listContainer) return;

    const searchQuery = (document.getElementById('journal-search')?.value || '').toLowerCase().trim();
    const envFilter = document.getElementById('journal-filter-env')?.value || 'all';

    const filtered = entries.filter(entry => {
      const matchesSearch = !searchQuery ||
        entry.title.toLowerCase().includes(searchQuery) ||
        entry.notes.toLowerCase().includes(searchQuery) ||
        (entry.location && entry.location.toLowerCase().includes(searchQuery));

      const matchesEnv = envFilter === 'all' || entry.environment === envFilter;
      return matchesSearch && matchesEnv;
    });

    if (filtered.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🌱</div>
          <h4>No observations found</h4>
          <p>Get outside, touch grass, and record what you see, hear, or feel in nature.</p>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = filtered.map(entry => {
      const escapeHtml = (str) => {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
      };

      const envBadges = {
        park: '🌲 Park',
        forest: '🍃 Forest',
        garden: '🌸 Garden',
        beach: '🌊 Beach',
        countryside: '🌾 Countryside',
        'indoor nature': '🪴 Indoor / Balcony'
      };

      return `
        <article class="journal-card" data-id="${entry.id}">
          <div class="journal-card-header">
            <div>
              <h3 class="journal-card-title">${escapeHtml(entry.title)}</h3>
              <div class="journal-meta">
                <span>📅 ${entry.date}</span>
                <span>📍 ${escapeHtml(entry.location)}</span>
                <span class="badge badge-sage">${envBadges[entry.environment] || entry.environment}</span>
                <span class="badge badge-earth">${escapeHtml(entry.mood)}</span>
              </div>
            </div>
            <div class="journal-actions">
              <button class="btn btn-sm btn-outline" onclick="JournalManager.editEntry('${entry.id}')" title="Edit entry">✏️ Edit</button>
              <button class="btn btn-sm btn-danger-outline" onclick="JournalManager.deleteEntry('${entry.id}')" title="Delete entry">🗑️ Delete</button>
            </div>
          </div>
          <p class="journal-card-body">${escapeHtml(entry.notes)}</p>
        </article>
      `;
    }).join('');

    updateJournalSummary();
  }

  function updateJournalSummary() {
    const countEl = document.getElementById('journal-count-badge');
    if (countEl) countEl.textContent = `${entries.length} entries`;

    const summaryEl = document.getElementById('stats-journal-count');
    if (summaryEl) summaryEl.textContent = entries.length;
  }

  function exportBackup() {
    if (entries.length === 0) {
      showToast('No journal entries to export.', 'warning');
      return;
    }

    const backupData = {
      app: 'TrailBuddy Offline',
      exported_at: new Date().toISOString(),
      schema_version: '1.0',
      entry_count: entries.length,
      entries: entries
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().split('T')[0];
    const a = document.createElement('a');
    a.href = url;
    a.download = `trailbuddy-nature-journal-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`Exported ${entries.length} entries to JSON backup file!`, 'success');
  }

  function handleImportBackup(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        const importedEntries = parsed.entries || (Array.isArray(parsed) ? parsed : null);

        if (!importedEntries || !Array.isArray(importedEntries)) {
          showToast('Invalid backup file. Missing entries array.', 'error');
          return;
        }

        let addedCount = 0;
        importedEntries.forEach(item => {
          if (item && item.title && item.notes) {
            // Check if duplicate ID exists; if so, assign new ID or update
            const exists = entries.some(existing => existing.id === item.id);
            if (!exists) {
              entries.push({
                id: item.id || 'entry-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
                title: item.title,
                notes: item.notes,
                location: item.location || 'Nature',
                date: item.date || new Date().toISOString().split('T')[0],
                environment: item.environment || 'park',
                mood: item.mood || 'peaceful',
                created_at: item.created_at || new Date().toISOString(),
                updated_at: new Date().toISOString()
              });
              addedCount++;
            }
          }
        });

        saveToStorage();
        renderJournalList();
        showToast(`Successfully restored ${addedCount} observations from backup!`, 'success');
      } catch (err) {
        console.error('Import parse error:', err);
        showToast('Error reading JSON backup. File might be corrupted.', 'error');
      } finally {
        e.target.value = ''; // Reset file input
      }
    };
    reader.readAsText(file);
  }

  function prefillFromPlan(title, reflectionQuestion) {
    // Switches to journal tab and pre-fills the form with plan reflection
    window.location.hash = '#journal';
    const titleInput = document.getElementById('journal-title');
    const notesInput = document.getElementById('journal-notes');
    if (titleInput) titleInput.value = `Reflection: ${title}`;
    if (notesInput) notesInput.value = `Prompt: "${reflectionQuestion}"\n\nMy observation: `;
    document.getElementById('journal-form-card')?.scrollIntoView({ behavior: 'smooth' });
    showToast('Plan reflection prompt copied to Nature Journal!', 'info');
  }

  function getCount() {
    return entries.length;
  }

  return {
    init,
    editEntry,
    deleteEntry,
    exportBackup,
    prefillFromPlan,
    getCount
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  JournalManager.init();
});
