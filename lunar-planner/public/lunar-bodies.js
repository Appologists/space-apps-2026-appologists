// Earth view (Google Street View + NASA EPIC) and Sun view (NASA SDO).

const $ = id => document.getElementById(id);
let googleReady = null;
let panorama = null;
let epicLoaded = false;

// Google calls this when the key is refused (for example, Maps JavaScript API not enabled).
window.gm_authFailure = () => {
    window.__gmapsAuthFailed = true;
    showEnablePrompt();
};

function showEnablePrompt() {
    const box = $('gsv');
    box.innerHTML = `
        <div class="enable">
            <h3>Turn on Google Street View</h3>
            <p>Google refused the map key. To see Earth at street level:</p>
            <ol>
                <li>Open the <a href="https://console.cloud.google.com/apis/library/maps-backend.googleapis.com" target="_blank" rel="noopener">Maps JavaScript API page</a> and click <b>Enable</b>.</li>
                <li>In <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Credentials</a>, open the key. Under API restrictions, allow <b>Maps JavaScript API</b>. Under website restrictions, allow <b>http://127.0.0.1:8002/*</b>.</li>
                <li>Check that billing is on for the project (Google needs it even for free use).</li>
                <li>Put the key in <b>lunar_keys.json</b> and reload this page.</li>
            </ol>
        </div>`;
    $('earth-where').textContent = 'Street View needs a Google key with Maps JavaScript API enabled.';
}

function loadGoogle(key) {
    if (googleReady) {
        return googleReady;
    }
    googleReady = new Promise((resolve, reject) => {
        if (!key) {
            reject(new Error('No Google Maps key in lunar_keys.json'));
            return;
        }
        window.__gmapsReady = () => resolve(window.google);
        const s = document.createElement('script');
        s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&callback=__gmapsReady`;
        s.async = true;
        s.onerror = () => reject(new Error('Google Maps could not load'));
        document.head.append(s);
    });
    return googleReady;
}

/** Open Street View at the panorama nearest to lat/lng (within 100 km). */
export async function showStreetView(key, lat, lng, label, onStatus) {
    const where = $('earth-where');
    where.textContent = `Looking for Street View near ${label}...`;
    try {
        const google = await loadGoogle(key);
        if (!panorama) {
            panorama = new google.maps.StreetViewPanorama($('gsv'), {
                addressControl: true,
                fullscreenControl: false,
                motionTracking: false,
                zoomControl: true,
            });
        }
        const service = new google.maps.StreetViewService();
        const {data} = await service.getPanorama({
            location: {lat, lng},
            radius: 100000,
            preference: google.maps.StreetViewPreference.NEAREST,
            source: google.maps.StreetViewSource.OUTDOOR,
        });
        panorama.setPano(data.location.pano);
        panorama.setPov({heading: 0, pitch: 0});
        panorama.setVisible(true);
        where.textContent = `Street View near ${label} \u00b7 ${data.location.description || ''}`;
        return true;
    } catch (e) {
        if (window.__gmapsAuthFailed || /key|load/i.test(e.message)) {
            showEnablePrompt();
        } else {
            where.textContent = `No Street View within 100 km of ${label}. Try a NASA center.`;
        }
        return false;
    }
}

export async function loadEpic() {
    if (epicLoaded) {
        return;
    }
    try {
        const r = await fetch('/api/epic');
        const j = await r.json();
        if (!r.ok) {
            throw Error(j.error);
        }
        $('epic-img').src = j.url;
        $('epic-cap').textContent = `Earth from NASA's EPIC camera on DSCOVR, 1.5 million km away \u00b7 ${j.date_utc} UTC`;
        epicLoaded = true;
    } catch (e) {
        $('epic-cap').textContent = 'NASA EPIC image not available right now.';
    }
}

export const SDO = {
    '0171': 'AIA 171 \u00c5: the quiet corona and coronal loops, about 600,000 \u00b0C.',
    '0304': 'AIA 304 \u00c5: the chromosphere and transition region, about 50,000 \u00b0C.',
    '0193': 'AIA 193 \u00c5: the hotter corona and flare plasma, about 1 million \u00b0C and above.',
    'HMIIC': 'HMI continuum: the Sun in visible light. Dark spots are sunspots.',
};

export function showSdo(channel) {
    $('sdo-img').src = `https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_${channel}.jpg`;
    $('sdo-cap').textContent = SDO[channel] + ' Latest image from NASA SDO.';
    for (const b of document.querySelectorAll('[data-sdo]')) {
        b.classList.toggle('active', b.dataset.sdo === channel);
    }
}
