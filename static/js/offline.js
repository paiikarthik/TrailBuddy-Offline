/**
 * static/js/offline.js - PWA, Network Status & Client-Side Offline Planner.
 *
 * Provides:
 * 1. Network status detection (online/offline indicator pill).
 * 2. Service Worker registration and update notifications.
 * 3. PWA "Install App" button handling.
 * 4. 100% In-Browser Rule-Based Planner Engine for when user is completely offline without server access.
 */

const OfflineManager = (() => {
  let deferredInstallPrompt = null;
  let cachedActivities = [];

  // Initialize service worker and network listeners
  function init() {
    registerServiceWorker();
    setupNetworkListeners();
    setupInstallPrompt();
    preloadActivitiesCatalog();
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/service-worker.js')
          .then((reg) => {
            console.log('[TrailBuddy PWA] Service Worker registered with scope:', reg.scope);
            reg.onupdatefound = () => {
              const installingWorker = reg.installing;
              if (installingWorker) {
                installingWorker.onstatechange = () => {
                  if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    showToast('Update available! Reload to get the latest offline features.', 'info');
                  }
                };
              }
            };
          })
          .catch((err) => {
            console.warn('[TrailBuddy PWA] Service Worker registration failed:', err);
          });
      });
    }
  }

  function setupNetworkListeners() {
    const updateStatus = () => {
      const isOnline = navigator.onLine;
      const statusPill = document.getElementById('network-status-pill');
      const statusText = document.getElementById('network-status-text');

      if (statusPill && statusText) {
        if (isOnline) {
          statusPill.className = 'status-pill online';
          statusText.textContent = 'Online';
          statusPill.setAttribute('title', 'Connected to the internet. Full AI & sync available.');
        } else {
          statusPill.className = 'status-pill offline';
          statusText.textContent = 'Offline';
          statusPill.setAttribute('title', 'Offline mode active. All essential features & offline planner available.');
          showToast('You are offline. Offline planner & local journal remain fully active!', 'warning');
        }
      }
    };

    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    updateStatus();
  }

  function setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      const installBtn = document.getElementById('btn-pwa-install');
      if (installBtn) {
        installBtn.style.display = 'inline-flex';
        installBtn.onclick = async () => {
          if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            const { outcome } = await deferredInstallPrompt.userChoice;
            console.log(`[PWA] Install prompt outcome: ${outcome}`);
            deferredInstallPrompt = null;
            installBtn.style.display = 'none';
          }
        };
      }
    });

    window.addEventListener('appinstalled', () => {
      console.log('[PWA] TrailBuddy installed successfully.');
      showToast('TrailBuddy installed to your home screen!', 'success');
      const installBtn = document.getElementById('btn-pwa-install');
      if (installBtn) installBtn.style.display = 'none';
    });
  }

  async function preloadActivitiesCatalog() {
    try {
      const resp = await fetch('/api/activities');
      if (resp.ok) {
        const data = await resp.json();
        cachedActivities = data.activities || [];
        localStorage.setItem('trailbuddy_cached_activities', JSON.stringify(cachedActivities));
      }
    } catch (e) {
      const saved = localStorage.getItem('trailbuddy_cached_activities');
      if (saved) {
        try {
          cachedActivities = JSON.parse(saved);
        } catch (_) {}
      }
    }
  }

  /**
   * Client-side rule-based planner engine.
   * Runs in the browser when server connection is lost or offline.
   */
  function generateClientOfflinePlan(userInput) {
    let activities = cachedActivities;
    if (!activities || activities.length === 0) {
      const saved = localStorage.getItem('trailbuddy_cached_activities');
      if (saved) {
        try {
          activities = JSON.parse(saved);
        } catch (_) {}
      }
    }

    if (!activities || activities.length === 0) {
      activities = [
        {
          id: "act-client-fallback",
          title: "Mindful Nature Sanctuary Stroll",
          activity_type: userInput.activity_type || "walking",
          environment: userInput.environment || "park",
          energy_level: userInput.energy_level || "moderate",
          budget: userInput.budget || "free",
          base_duration: userInput.time_available || "30 minutes",
          steps: [
            "Step outdoors into your nearest open green space or natural corridor.",
            "Begin walking slowly, noticing the rhythm of your breath and footsteps.",
            "Observe trees, birds, or plant patterns without checking your phone.",
            "Conclude with three deep diaphragmatic breaths of fresh outdoor air."
          ],
          equipment: ["Comfortable walking shoes", "Water bottle", "Weather layer"],
          nature_observation_task: "Notice five distinct natural colors or shapes in your surroundings.",
          screen_free_recommendation: "Keep your smartphone turned off or stowed away in your pocket.",
          safety_checklist: [
            "Check local weather conditions before heading out.",
            "Stick to clear paths and respect surrounding flora and fauna.",
            "Stay hydrated."
          ],
          reflection_question: "How did slowing down and unplugging shift your mental energy?"
        }
      ];
    }

    // Score activities
    let bestAct = activities[0];
    let maxScore = -1;

    for (const act of activities) {
      let score = 0;
      if (act.activity_type === userInput.activity_type) score += 40;
      if (act.environment === userInput.environment) score += 30;
      if (act.energy_level === userInput.energy_level) score += 20;
      if (act.base_duration === userInput.time_available) score += 15;
      if (act.budget === userInput.budget || userInput.budget === 'flexible') score += 10;

      // Accessibility
      const acc = act.accessibility || {};
      const reqAcc = userInput.accessibility || {};
      for (const [k, v] of Object.entries(reqAcc)) {
        if (v) {
          if (acc[k]) score += 15;
          else score -= 10;
        }
      }

      if (score > maxScore) {
        maxScore = score;
        bestAct = act;
      }
    }

    // Adapt for duration
    const reqDuration = userInput.time_available || "30 minutes";
    const steps = [...(bestAct.steps || [])];
    const equipment = [...(bestAct.equipment || [])];
    const safety = [...(bestAct.safety_checklist || [])];

    if (reqDuration.includes("15")) {
      steps.unshift("Take a minute to set your phone on silent and step into nature.");
    } else if (reqDuration.includes("half a day")) {
      steps.push("Take regular rest stops every 45 minutes to rehydrate and stretch.");
      equipment.push("Nutritious trail snack", "Sun hat");
    }

    return {
      title: `${bestAct.title} (Offline Mode)`,
      estimated_duration: reqDuration,
      step_by_step_instructions: steps,
      required_equipment: equipment,
      estimated_budget: bestAct.budget === "free" ? "Free ($0 — Uses existing items)" : "Low Cost",
      nature_observation_task: bestAct.nature_observation_task || "Observe subtle wind movements in tree branches.",
      screen_free_recommendation: bestAct.screen_free_recommendation || "Slip your phone into your bag until you complete your activity.",
      safety_checklist: safety,
      reflection_question: bestAct.reflection_question || "What unexpected detail did you notice in nature today?",
      disclaimer: "Independent verification required: Weather conditions, trail accessibility, and park opening hours vary. Always independently verify local safety rules and environmental conditions before departing.",
      source: "rule_based",
      model: "In-Browser Offline Engine (Zero Network)",
      fallback_reason: "Device is offline or backend server was unreachable. Generated 100% locally.",
      generated_at: new Date().toISOString()
    };
  }

  return {
    init,
    generateClientOfflinePlan
  };
})();

// Simple notification toast helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-fade');
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

document.addEventListener('DOMContentLoaded', () => {
  OfflineManager.init();
});
