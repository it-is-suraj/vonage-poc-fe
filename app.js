// Replace with your deployed backend URL in production
const BACKEND_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:5000'
  : 'https://vonage-poc-be.onrender.com';

const joinBtn = document.getElementById('join-btn');
const leaveBtn = document.getElementById('leave-btn');
const roomInput = document.getElementById('room-input');
const userInput = document.getElementById('user-input');
const statusBar = document.getElementById('status');
const videoGrid = document.getElementById('video-grid');

let session = null;
let publisher = null;

function setStatus(msg) {
  statusBar.innerText = `Status: ${msg}`;
}

// Safely parse JSON from token connection data
function parseUserData(dataString) {
  try {
    return JSON.parse(dataString);
  } catch {
    return { userId: dataString || 'Unknown' };
  }
}

joinBtn.addEventListener('click', async () => {
  const roomName = roomInput.value.trim();
  const userId = userInput.value.trim();

  if (!roomName || !userId) {
    return alert('Both Room Name and User Identifier are required');
  }

  setStatus('Requesting session token...');
  joinBtn.disabled = true;

  try {
    const res = await fetch(`${BACKEND_URL}/api/session/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomName, userId })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');

    startConference(data.applicationId, data.sessionId, data.token, userId);
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`);
    joinBtn.disabled = false;
  }
});

function startConference(applicationId, sessionId, token, myUserId) {
  setStatus('Connecting to session...');
  session = OT.initSession(applicationId, sessionId);

  // Handle incoming streams from other participants
  session.on('streamCreated', (event) => {
    const remoteData = parseUserData(event.stream.connection.data);

    // Create dedicated wrapper container for subscriber
    const wrapper = document.createElement('div');
    wrapper.id = `sub-wrapper-${event.stream.streamId}`;
    wrapper.className = 'participant-wrapper';

    const badge = document.createElement('div');
    badge.className = 'user-badge';
    badge.innerText = `User: ${remoteData.userId}`;
    wrapper.appendChild(badge);

    const videoMount = document.createElement('div');
    videoMount.id = `sub-mount-${event.stream.streamId}`;
    wrapper.appendChild(videoMount);

    videoGrid.appendChild(wrapper);

    session.subscribe(event.stream, videoMount.id, {
      insertMode: 'replace',
      width: '100%',
      height: '100%'
    }, (err) => {
      if (err) console.error('Subscription error:', err);
    });
  });

  // Remove subscriber container when stream ends
  session.on('streamDestroyed', (event) => {
    const el = document.getElementById(`sub-wrapper-${event.stream.streamId}`);
    if (el) el.remove();
  });

  session.on('archiveStarted', (event) => {
    setStatus(`Recording active (Archive ID: ${event.id})`);
  });

  session.on('sessionDisconnected', () => {
    setStatus('Disconnected');
    videoGrid.innerHTML = '';
    joinBtn.disabled = false;
    leaveBtn.disabled = true;
  });

  // Connect to session
  session.connect(token, (err) => {
    if (err) {
      setStatus(`Connect failed: ${err.message}`);
      joinBtn.disabled = false;
      return;
    }

    leaveBtn.disabled = false;
    setStatus(`Connected as "${myUserId}". Publishing stream...`);

    // Create container for local user
    const pubWrapper = document.createElement('div');
    pubWrapper.className = 'participant-wrapper';

    const pubBadge = document.createElement('div');
    pubBadge.className = 'user-badge';
    pubBadge.innerText = `You (${myUserId})`;
    pubWrapper.appendChild(pubBadge);

    const pubMount = document.createElement('div');
    pubMount.id = 'local-publisher';
    pubWrapper.appendChild(pubMount);

    videoGrid.appendChild(pubWrapper);

    publisher = OT.initPublisher(pubMount.id, {
      insertMode: 'replace',
      width: '100%',
      height: '100%',
      name: myUserId
    }, (pubInitErr) => {
      if (pubInitErr) {
        console.error('Publisher initialization failed:', pubInitErr);
        return;
      }

      // 1. Start Audio Connector for the publisher
      publisher.on('streamCreated', async (event) => {
        const streamId = event.stream.id;
        console.log(`[AudioConnector] Local stream live: ${streamId}. Initiating connector...`);

        try {
          const res = await fetch(`${BACKEND_URL}/api/audio-connector/start-participant`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: session.sessionId,
              streamId: streamId,
              userId: myUserId
            })
          });

          const data = await res.json();
          if (!response.ok) {
            console.error('[TEST] Server rejected start-participant:', data);
          } else {
            console.log('[TEST] Audio Connector started successfully:', data);
          }
        } catch (audioErr) {
          console.error('[AudioConnector] Failed to start:', audioErr);
        }
      });

      // 2. Triggered when the user leaves, unpublishes, or closes the call
      publisher.on('streamDestroyed', async (event) => {
        const streamId = event.stream.id;
        console.log(`[AudioConnector] Local stream destroyed: ${streamId}. Stopping connector...`);

        try {
          await fetch(`${BACKEND_URL}/api/audio/stop-participant`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ streamId })
          });
          console.log('[AudioConnector] Audio Connector stop request completed');
        } catch (audioErr) {
          console.error('[AudioConnector] Failed to stop:', audioErr);
        }
      });

      // Publish to the session
      session.publish(publisher, (pubSessionErr) => {
        if (pubSessionErr) console.error('Publish error:', pubSessionErr);
      });
    });
  });
}

leaveBtn.addEventListener('click', () => {
  if (session) {
    session.disconnect();
  }
});

async function checkServerWarmup() {
  const startTime = Date.now();
  setStatus('Warming up server (may take ~30s on cold start)...');
  joinBtn.disabled = true;

  try {
    const res = await fetch(`${BACKEND_URL}/health`);
    if (!res.ok) throw new Error('Health check failed');

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    setStatus(`Server active (responded in ${elapsed}s). Ready to join.`);
    joinBtn.disabled = false;
  } catch (err) {
    console.error('Server warmup error:', err);
    setStatus('Failed to reach server. Refresh or check backend status.');
  }
}

window.addEventListener('DOMContentLoaded', checkServerWarmup);