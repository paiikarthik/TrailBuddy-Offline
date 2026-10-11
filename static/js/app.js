/**
 * static/js/app.js - Main Application Controller for TrailBuddy Offline.
 *
 * Coordinates:
 * - Single-Page Tab Navigation and deep linking
 * - Screen-free outdoor session timer & streak tracker
 * - AI Outdoor Planner with in-browser offline fallback
 * - Touch Grass challenge catalog & completion tracking
 * - Local discovery catalog and user spots
 * - Global dashboard statistics
 */

const TrailBuddyApp = (() => {
  // Application State
  let challengesList = [];
  let activitiesList = [];
  let timerInterval = null;
  let timerSeconds = 0;
  let timerRunning = false;

  function init() {
    setupTabNavigation();
    setupScreenFreeTimer();
    setupPlannerForm();
    loadChallenges();
    loadDiscoveryActivities();
    loadUserSpots();
    updateDashboardStats();

    // Handle initial hash in URL
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
  }

  // ===========================================================================
  // Tab Navigation
  // ===========================================================================

  function setupTabNavigation() {
    const navButtons = document.querySelectorAll('[data-tab-target]');
    navButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = btn.getAttribute('data-tab-target');
        switchTab(targetId);
      });
    });
  }

  function handleHashChange() {
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    switchTab(hash);
  }

  function switchTab(tabId) {
    const validTabs = ['dashboard', 'planner', 'journal', 'challenges', 'discover', 'about'];
    const activeTab = validTabs.includes(tabId) ? tabId : 'dashboard';

    // Update nav links
    document.querySelectorAll('.nav-link, .tab-btn').forEach(btn => {
      if (btn.getAttribute('data-tab-target') === activeTab) {
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
      }
    });

    // Toggle tab sections
    document.querySelectorAll('.tab-section').forEach(section => {
      if (section.id === `section-${activeTab}`) {
        section.classList.add('active');
        section.hidden = false;
      } else {
        section.classList.remove('active');
        section.hidden = true;
      }
    });

    // Update window hash without jump
    if (window.location.hash !== `#${activeTab}`) {
      history.replaceState(null, '', `#${activeTab}`);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ===========================================================================
  // Screen-Free Outdoor Timer & Tracker
  // ===========================================================================

  function setupScreenFreeTimer() {
    const startBtn = document.getElementById('timer-btn-toggle');
    const resetBtn = document.getElementById('timer-btn-reset');
    const logBtn = document.getElementById('timer-btn-log');

    if (startBtn) {
      startBtn.addEventListener('click', toggleTimer);
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', resetTimer);
    }
    if (logBtn) {
      logBtn.addEventListener('click', logCurrentTimerSession);
    }

    renderTimerDisplay();
  }

  function toggleTimer() {
    const startBtn = document.getElementById('timer-btn-toggle');
    const logBtn = document.getElementById('timer-btn-log');

    if (!timerRunning) {
      // Start timer
      timerRunning = true;
      timerInterval = setInterval(() => {
        timerSeconds++;
        renderTimerDisplay();
      }, 1000);

      if (startBtn) {
        startBtn.innerHTML = '⏸️ Pause';
        startBtn.classList.remove('btn-primary');
        startBtn.classList.add('btn-warning');
      }
      if (logBtn) logBtn.disabled = false;
      showToast('Screen-free session started! Put your phone away and enjoy nature.', 'info');
    } else {
      // Pause timer
      timerRunning = false;
      clearInterval(timerInterval);
      if (startBtn) {
        startBtn.innerHTML = '▶️ Resume';
        startBtn.classList.remove('btn-warning');
        startBtn.classList.add('btn-primary');
      }
    }
  }

  function resetTimer() {
    if (timerSeconds > 0 && !confirm('Reset timer to zero?')) return;
    timerRunning = false;
    clearInterval(timerInterval);
    timerSeconds = 0;
    renderTimerDisplay();

    const startBtn = document.getElementById('timer-btn-toggle');
    const logBtn = document.getElementById('timer-btn-log');
    if (startBtn) {
      startBtn.innerHTML = '🌱 Start Outdoor Session';
      startBtn.className = 'btn btn-primary';
    }
    if (logBtn) logBtn.disabled = true;
  }

  function renderTimerDisplay() {
    const display = document.getElementById('timer-display');
    if (!display) return;

    const mins = Math.floor(timerSeconds / 60);
    const secs = timerSeconds % 60;
    display.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function logCurrentTimerSession() {
    if (timerSeconds < 60) {
      showToast('Spend at least 1 full minute outdoors before logging your session.', 'warning');
      return;
    }

    const minutesSpent = Math.round(timerSeconds / 60);
    const sessions = getStoredSessions();
    const today = new Date().toISOString().split('T')[0];

    sessions.push({
      id: 'session-' + Date.now(),
      date: today,
      minutes: minutesSpent,
      timestamp: new Date().toISOString()
    });

    localStorage.setItem('trailbuddy_screen_free_sessions', JSON.stringify(sessions));
    showToast(`Logged ${minutesSpent} screen-free outdoor minutes! Amazing job touching grass.`, 'success');

    resetTimer();
    updateDashboardStats();
  }

  function getStoredSessions() {
    try {
      const data = localStorage.getItem('trailbuddy_screen_free_sessions');
      return data ? JSON.parse(data) : [];
    } catch (_) {
      return [];
    }
  }

  // ===========================================================================
  // AI Outdoor Planner & Offline Generation
  // ===========================================================================

  function setupPlannerForm() {
    const form = document.getElementById('planner-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleGeneratePlan();
    });

    // Preset button listeners (quick selections)
    document.querySelectorAll('[data-preset-time]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sel = document.getElementById('plan-time');
        if (sel) sel.value = btn.getAttribute('data-preset-time');
      });
    });
  }

  async function handleGeneratePlan() {
    const submitBtn = document.getElementById('btn-generate-plan');
    const loadingEl = document.getElementById('planner-loading');
    const resultCard = document.getElementById('planner-result-card');

    // Collect user inputs
    const timeAvailable = document.getElementById('plan-time').value;
    const activityType = document.getElementById('plan-activity').value;
    const energyLevel = document.getElementById('plan-energy').value;
    const budget = document.getElementById('plan-budget').value;
    const environment = document.getElementById('plan-environment').value;

    const accessibility = {
      wheelchair_accessible: document.getElementById('acc-wheelchair')?.checked || false,
      seated_option: document.getElementById('acc-seated')?.checked || false,
      low_impact: document.getElementById('acc-low-impact')?.checked || false,
      paved_trail: document.getElementById('acc-paved')?.checked || false,
      sensory_friendly: document.getElementById('acc-sensory')?.checked || false
    };

    const payload = {
      time_available: timeAvailable,
      activity_type: activityType,
      energy_level: energyLevel,
      budget: budget,
      environment: environment,
      accessibility: accessibility
    };

    // UI loading state
    if (submitBtn) submitBtn.disabled = true;
    if (loadingEl) loadingEl.style.display = 'block';
    if (resultCard) resultCard.style.display = 'none';

    let planData = null;

    // Check if browser is online
    if (navigator.onLine) {
      try {
        const response = await fetch('/api/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const resJson = await response.json();
          if (resJson.success && resJson.plan) {
            planData = resJson.plan;
          }
        } else {
          console.warn('API returned non-200. Falling back to local offline planner.');
        }
      } catch (networkErr) {
        console.warn('Network error reaching backend. Falling back to in-browser offline planner.', networkErr);
      }
    }

    // If offline or network call failed, run in-browser offline engine
    if (!planData) {
      planData = OfflineManager.generateClientOfflinePlan(payload);
    }

    // Render result
    if (submitBtn) submitBtn.disabled = false;
    if (loadingEl) loadingEl.style.display = 'none';

    if (planData) {
      renderGeneratedPlan(planData);
      if (resultCard) {
        resultCard.style.display = 'block';
        resultCard.scrollIntoView({ behavior: 'smooth' });
      }
    } else {
      showToast('Could not generate plan. Please try again.', 'error');
    }
  }

  function renderGeneratedPlan(plan) {
    const titleEl = document.getElementById('plan-result-title');
    const durationEl = document.getElementById('plan-result-duration');
    const budgetEl = document.getElementById('plan-result-budget');
    const badgeSource = document.getElementById('plan-source-badge');
    const fallbackNote = document.getElementById('plan-fallback-note');
    const stepsList = document.getElementById('plan-steps-list');
    const equipList = document.getElementById('plan-equip-list');
    const obsTaskEl = document.getElementById('plan-obs-task');
    const screenTipEl = document.getElementById('plan-screen-tip');
    const safetyList = document.getElementById('plan-safety-list');
    const reflectQEl = document.getElementById('plan-reflect-q');
    const btnJournalShortcut = document.getElementById('btn-plan-journal-shortcut');
    const btnCopyPlan = document.getElementById('btn-plan-copy');

    if (titleEl) titleEl.textContent = plan.title;
    if (durationEl) durationEl.textContent = `⏱️ ${plan.estimated_duration}`;
    if (budgetEl) budgetEl.textContent = `💰 ${plan.estimated_budget}`;

    // Source badge
    if (badgeSource) {
      if (plan.source === 'ai') {
        badgeSource.className = 'source-badge source-ai';
        badgeSource.innerHTML = `✨ AI-Generated (${plan.model || 'Open-Weight Model'})`;
      } else {
        badgeSource.className = 'source-badge source-offline';
        badgeSource.innerHTML = `🌿 Generated via Offline Engine (${plan.model || 'Rule-Based Engine'})`;
      }
    }

    // Fallback reason note
    if (fallbackNote) {
      if (plan.fallback_reason) {
        fallbackNote.textContent = `Notice: ${plan.fallback_reason}`;
        fallbackNote.style.display = 'block';
      } else {
        fallbackNote.style.display = 'none';
      }
    }

    // Step by step
    if (stepsList) {
      stepsList.innerHTML = (plan.step_by_step_instructions || []).map((step, idx) => `
        <li class="plan-step-item">
          <label class="checkbox-label">
            <input type="checkbox" class="step-checkbox" id="step-chk-${idx}">
            <span class="step-text">${step}</span>
          </label>
        </li>
      `).join('');
    }

    // Equipment
    if (equipList) {
      equipList.innerHTML = (plan.required_equipment || []).map(item => `
        <span class="badge badge-sage">🎒 ${item}</span>
      `).join('');
    }

    // Observation Task & Screen-free tip
    if (obsTaskEl) obsTaskEl.textContent = plan.nature_observation_task;
    if (screenTipEl) screenTipEl.textContent = plan.screen_free_recommendation;

    // Safety Checklist
    if (safetyList) {
      safetyList.innerHTML = (plan.safety_checklist || []).map(item => `
        <li>${item}</li>
      `).join('');
    }

    // Reflection question
    if (reflectQEl) reflectQEl.textContent = plan.reflection_question;

    // Journal shortcut button
    if (btnJournalShortcut) {
      btnJournalShortcut.onclick = () => {
        JournalManager.prefillFromPlan(plan.title, plan.reflection_question);
      };
    }

    // Copy plan button
    if (btnCopyPlan) {
      btnCopyPlan.onclick = () => {
        const textSummary = `TrailBuddy Outdoor Plan: ${plan.title}\nDuration: ${plan.estimated_duration}\nBudget: ${plan.estimated_budget}\n\nSteps:\n${(plan.step_by_step_instructions || []).map((s, i) => `${i+1}. ${s}`).join('\n')}\n\nEquipment:\n${(plan.required_equipment || []).join(', ')}\n\nMindful Task: ${plan.nature_observation_task}\n\nScreen-Free Tip: ${plan.screen_free_recommendation}\n\nReflection Question: ${plan.reflection_question}\n\n*Always verify local weather and conditions.*`;
        navigator.clipboard.writeText(textSummary)
          .then(() => showToast('Full plan copied to clipboard!', 'success'))
          .catch(() => showToast('Could not copy to clipboard.', 'error'));
      };
    }
  }

  // ===========================================================================
  // Touch Grass Challenges
  // ===========================================================================

  async function loadChallenges() {
    try {
      const resp = await fetch('/api/challenges');
      if (resp.ok) {
        const data = await resp.json();
        challengesList = data.challenges || [];
        localStorage.setItem('trailbuddy_cached_challenges', JSON.stringify(challengesList));
      }
    } catch (e) {
      const cached = localStorage.getItem('trailbuddy_cached_challenges');
      if (cached) {
        try { challengesList = JSON.parse(cached); } catch (_) {}
      }
    }

    renderChallengesCatalog();
    renderDailyChallenge();
  }

  function getCompletedChallenges() {
    try {
      const data = localStorage.getItem('trailbuddy_completed_challenges');
      return data ? JSON.parse(data) : [];
    } catch (_) {
      return [];
    }
  }

  function renderDailyChallenge() {
    const dailyCard = document.getElementById('daily-challenge-container');
    if (!dailyCard || challengesList.length === 0) return;

    // Deterministic selection based on day of year
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const diff = now - start;
    const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
    const dailyIndex = dayOfYear % challengesList.length;
    const daily = challengesList[dailyIndex];

    const completedList = getCompletedChallenges();
    const isCompleted = completedList.includes(daily.id);

    dailyCard.innerHTML = `
      <div class="daily-badge">🌟 Today's Touch Grass Mission</div>
      <h3 class="daily-title">${daily.title}</h3>
      <p class="daily-summary">${daily.summary}</p>
      <div class="daily-meta">
        <span>⏱️ ${daily.estimated_minutes} min</span>
        <span class="badge badge-earth">${daily.category}</span>
        <span class="badge badge-sage">${daily.difficulty}</span>
      </div>
      <div class="daily-actions">
        ${isCompleted ? `
          <button class="btn btn-sm btn-outline" disabled>✅ Completed Today</button>
        ` : `
          <button class="btn btn-sm btn-primary" onclick="TrailBuddyApp.completeChallenge('${daily.id}')">🌿 Mark Completed</button>
        `}
        <button class="btn btn-sm btn-outline" onclick="TrailBuddyApp.viewChallengeDetails('${daily.id}')">View Steps</button>
      </div>
    `;
  }

  function renderChallengesCatalog() {
    const container = document.getElementById('challenges-grid');
    if (!container) return;

    const filterCategory = document.getElementById('challenge-category-filter')?.value || 'all';
    const completedList = getCompletedChallenges();

    const filtered = challengesList.filter(chal => {
      return filterCategory === 'all' || chal.category === filterCategory;
    });

    if (filtered.length === 0) {
      container.innerHTML = `<div class="empty-state"><p>No challenges found for this category.</p></div>`;
      return;
    }

    container.innerHTML = filtered.map(chal => {
      const isDone = completedList.includes(chal.id);
      return `
        <div class="challenge-card ${isDone ? 'challenge-completed' : ''}" id="chal-card-${chal.id}">
          <div class="challenge-card-top">
            <span class="badge badge-earth">${chal.category}</span>
            <span class="badge badge-sage">${chal.difficulty}</span>
            ${isDone ? '<span class="status-pill online">Done</span>' : ''}
          </div>
          <h4 class="challenge-card-title">${chal.title}</h4>
          <p class="challenge-card-desc">${chal.summary}</p>
          <div class="challenge-card-footer">
            <span class="challenge-time">⏱️ ${chal.estimated_minutes} mins</span>
            <div class="btn-group">
              <button class="btn btn-sm btn-outline" onclick="TrailBuddyApp.viewChallengeDetails('${chal.id}')">Details</button>
              ${isDone ? `
                <button class="btn btn-sm btn-outline" onclick="TrailBuddyApp.uncompleteChallenge('${chal.id}')" title="Reset status">↩️ Reset</button>
              ` : `
                <button class="btn btn-sm btn-primary" onclick="TrailBuddyApp.completeChallenge('${chal.id}')">Complete</button>
              `}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Setup category filter listener once
    const filterEl = document.getElementById('challenge-category-filter');
    if (filterEl && !filterEl.hasAttribute('data-listening')) {
      filterEl.setAttribute('data-listening', 'true');
      filterEl.addEventListener('change', () => renderChallengesCatalog());
    }
  }

  function completeChallenge(id) {
    const chal = challengesList.find(c => c.id === id);
    if (!chal) return;

    if (!confirm(`Confirm completing "${chal.title}"?\n\nHave you completed the real-world outdoor steps?`)) {
      return;
    }

    const completed = getCompletedChallenges();
    if (!completed.includes(id)) {
      completed.push(id);
      localStorage.setItem('trailbuddy_completed_challenges', JSON.stringify(completed));
    }

    showToast(`Bravo! Challenge "${chal.title}" completed! You touched grass today.`, 'success');
    renderChallengesCatalog();
    renderDailyChallenge();
    updateDashboardStats();
  }

  function uncompleteChallenge(id) {
    let completed = getCompletedChallenges();
    completed = completed.filter(cId => cId !== id);
    localStorage.setItem('trailbuddy_completed_challenges', JSON.stringify(completed));
    showToast('Challenge status reset.', 'info');
    renderChallengesCatalog();
    renderDailyChallenge();
    updateDashboardStats();
  }

  function viewChallengeDetails(id) {
    const chal = challengesList.find(c => c.id === id);
    if (!chal) return;

    const modal = document.getElementById('challenge-modal');
    const modalBody = document.getElementById('challenge-modal-body');
    if (!modal || !modalBody) return;

    modalBody.innerHTML = `
      <h3>${chal.title}</h3>
      <p class="lead">${chal.summary}</p>
      <div class="daily-meta" style="margin: 12px 0;">
        <span>⏱️ Estimated Time: ${chal.estimated_minutes} minutes</span>
        <span class="badge badge-earth">${chal.category}</span>
        <span class="badge badge-sage">${chal.difficulty}</span>
      </div>
      <h4>Step-by-Step Instructions:</h4>
      <ol style="margin-left: 20px; line-height: 1.6;">
        ${(chal.instructions || []).map(step => `<li>${step}</li>`).join('')}
      </ol>
      <div class="highlight-box" style="margin-top: 16px;">
        <strong>💡 Screen-Free Tip:</strong> ${chal.offline_tip || 'Keep your phone tucked away in your pocket.'}
      </div>
      <div class="highlight-box" style="margin-top: 12px; background: #fdfaf4;">
        <strong>🤔 Reflection Prompt:</strong> ${chal.reflection_prompt || 'What did you notice about yourself in nature?'}
      </div>
    `;

    modal.style.display = 'flex';
  }

  // ===========================================================================
  // Local Discovery Catalog & Custom User Spots
  // ===========================================================================

  async function loadDiscoveryActivities() {
    try {
      const resp = await fetch('/api/activities');
      if (resp.ok) {
        const data = await resp.json();
        activitiesList = data.activities || [];
      }
    } catch (_) {}

    renderDiscoveryCards();
  }

  function renderDiscoveryCards() {
    const grid = document.getElementById('discovery-grid');
    if (!grid) return;

    const envFilter = document.getElementById('discovery-env-filter')?.value || 'all';

    const filtered = activitiesList.filter(act => {
      return envFilter === 'all' || act.environment === envFilter;
    });

    if (filtered.length === 0) {
      grid.innerHTML = `<div class="empty-state"><p>No discovery activities for this filter.</p></div>`;
      return;
    }

    grid.innerHTML = filtered.map(act => `
      <div class="discovery-card">
        <div class="discovery-card-header">
          <span class="badge badge-earth">${act.environment}</span>
          <span class="badge badge-sage">${act.activity_type}</span>
          <span class="badge badge-cream">${act.energy_level} energy</span>
        </div>
        <h4 class="discovery-card-title">${act.title}</h4>
        <div class="sample-location-tag">
          📍 Demonstration Spot: <strong>${act.sample_location || 'Local Green Corridor (Demo)'}</strong>
        </div>
        <p class="discovery-card-desc">${act.description}</p>
        <div class="discovery-card-footer">
          <span>⏱️ ${act.base_duration}</span>
          <button class="btn btn-sm btn-outline" onclick="TrailBuddyApp.adoptDiscoveryActivity('${act.id}')">Plan This</button>
        </div>
      </div>
    `).join('');

    const filterEl = document.getElementById('discovery-env-filter');
    if (filterEl && !filterEl.hasAttribute('data-listening')) {
      filterEl.setAttribute('data-listening', 'true');
      filterEl.addEventListener('change', () => renderDiscoveryCards());
    }
  }

  function adoptDiscoveryActivity(id) {
    const act = activitiesList.find(a => a.id === id);
    if (!act) return;

    // Switch to planner and pre-fill form
    switchTab('planner');
    if (document.getElementById('plan-activity')) document.getElementById('plan-activity').value = act.activity_type;
    if (document.getElementById('plan-environment')) document.getElementById('plan-environment').value = act.environment;
    if (document.getElementById('plan-energy')) document.getElementById('plan-energy').value = act.energy_level;
    showToast(`Adopted "${act.title}" into Planner! Customize and generate your itinerary.`, 'info');
  }

  function setupUserSpotForm() {
    const form = document.getElementById('custom-spot-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('spot-name').value.trim();
      const type = document.getElementById('spot-type').value;
      const notes = document.getElementById('spot-notes').value.trim();

      if (!name) return;

      const spots = getUserSpots();
      spots.unshift({
        id: 'spot-' + Date.now(),
        name,
        type,
        notes,
        created_at: new Date().toISOString()
      });

      localStorage.setItem('trailbuddy_user_spots', JSON.stringify(spots));
      form.reset();
      renderUserSpots();
      showToast('Custom spot saved locally in your browser!', 'success');
    });
  }

  function getUserSpots() {
    try {
      const data = localStorage.getItem('trailbuddy_user_spots');
      return data ? JSON.parse(data) : [];
    } catch (_) {
      return [];
    }
  }

  function loadUserSpots() {
    setupUserSpotForm();
    renderUserSpots();
  }

  function renderUserSpots() {
    const container = document.getElementById('user-spots-list');
    if (!container) return;

    const spots = getUserSpots();
    if (spots.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 15px;">
          <p>No personal spots saved yet. Add your favorite neighborhood park or tree bench above!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = spots.map(spot => `
      <div class="user-spot-item">
        <div>
          <strong>📍 ${spot.name}</strong> <span class="badge badge-sage">${spot.type}</span>
          ${spot.notes ? `<p class="spot-note">${spot.notes}</p>` : ''}
        </div>
        <button class="btn btn-sm btn-danger-outline" onclick="TrailBuddyApp.deleteUserSpot('${spot.id}')">Delete</button>
      </div>
    `).join('');
  }

  function deleteUserSpot(id) {
    let spots = getUserSpots();
    spots = spots.filter(s => s.id !== id);
    localStorage.setItem('trailbuddy_user_spots', JSON.stringify(spots));
    renderUserSpots();
    showToast('Spot removed.', 'info');
  }

  // ===========================================================================
  // Dashboard Metrics & Progress Calculation
  // ===========================================================================

  function updateDashboardStats() {
    const sessions = getStoredSessions();
    const completedChallenges = getCompletedChallenges();
    const journalCount = JournalManager.getCount ? JournalManager.getCount() : 0;

    // Calculate total screen-free minutes
    const totalMinutes = sessions.reduce((acc, s) => acc + (s.minutes || 0), 0);

    // Calculate streak
    const dates = [...new Set(sessions.map(s => s.date))].sort().reverse();
    let streak = 0;
    if (dates.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      if (dates[0] === today || dates[0] === yesterday) {
        streak = 1;
        let prev = new Date(dates[0]);
        for (let i = 1; i < dates.length; i++) {
          const curr = new Date(dates[i]);
          const diffDays = Math.round((prev - curr) / 86400000);
          if (diffDays === 1) {
            streak++;
            prev = curr;
          } else {
            break;
          }
        }
      }
    }

    const statMinutes = document.getElementById('stats-screenfree-mins');
    const statChallenges = document.getElementById('stats-challenges-done');
    const statJournal = document.getElementById('stats-journal-count');
    const statStreak = document.getElementById('stats-streak-days');

    if (statMinutes) statMinutes.textContent = totalMinutes;
    if (statChallenges) statChallenges.textContent = completedChallenges.length;
    if (statJournal) statJournal.textContent = journalCount;
    if (statStreak) statStreak.textContent = streak;
  }

  return {
    init,
    switchTab,
    completeChallenge,
    uncompleteChallenge,
    viewChallengeDetails,
    adoptDiscoveryActivity,
    deleteUserSpot,
    updateDashboardStats
  };
})();

// Close modal when clicking close button or outside
window.addEventListener('DOMContentLoaded', () => {
  TrailBuddyApp.init();

  const modal = document.getElementById('challenge-modal');
  const closeBtn = document.getElementById('btn-close-modal');
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => modal.style.display = 'none');
  }
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  }
});
