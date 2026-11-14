// Missions, XP, NASA facts and quiz. No three.js here.

const SRC = {
    moon: 'https://science.nasa.gov/moon/facts/',
    sun: 'https://science.nasa.gov/sun/facts/',
    earth: 'https://science.nasa.gov/earth/facts/',
};

// Short paraphrases of NASA's fact pages (science.nasa.gov, read 2026-11-14).
export const FACTS = {
    moon: [
        'The Moon is about 384,400 km from Earth on average. About 30 Earth-sized planets would fit in that gap.',
        'The Moon has a radius of about 1,740 km, less than a third of the width of Earth.',
        'The Moon orbits Earth in about 27 days and spins once in the same time. That is why the same side always faces us.',
        'In full sunlight the surface reaches about 127 \u00b0C. In darkness it drops to about -173 \u00b0C.',
        'Apollo astronauts brought 382 kg of lunar rock and soil back to Earth.',
        'Humans first saw the far side of the Moon in 1959, when a Soviet spacecraft flew past it.',
        'The dark patches, called maria ("seas"), are impact basins that filled with lava between 4.2 and 1.2 billion years ago.',
        'More than 105 robotic spacecraft have been launched to explore the Moon.',
        'In 2020, NASA\'s SOFIA observatory confirmed water molecules on the sunlit Moon, in Clavius Crater.',
        'The Moon\'s crust is about 40 km thick on the near side and up to about 60 km thick on the far side.',
    ],
    sun: [
        'The Sun is about 150 million km from Earth, and it is our solar system\'s only star.',
        'The Sun is about 100 times wider than Earth.',
        'The Sun\'s visible surface is about 5,500 \u00b0C. Its core is about 15 million \u00b0C, hot enough for nuclear fusion.',
        'The Sun\'s outer atmosphere, the corona, reaches up to 2 million \u00b0C, much hotter than the surface below it.',
        'The Sun holds 99.8% of all the mass in our solar system.',
        'It would take more than 330,000 Earths to match the Sun\'s mass.',
        'The Sun spins once every 25 days at its equator, but every 36 days at its poles.',
        'The Sun formed about 4.6 billion years ago and should shine for about 5 billion years more.',
        'Energy from the core takes about 170,000 years to cross the Sun\'s radiative zone.',
        'A solar flare in March 1989 caused a blackout in Quebec that left 6 million people without power for 9 hours.',
    ],
    earth: [
        'Earth is about 12,756 km wide at the equator, the biggest of the rocky planets.',
        'Earth is one astronomical unit from the Sun: about 150 million km.',
        'Earth spins once every 23.9 hours and orbits the Sun every 365.25 days.',
        'Earth\'s axis is tilted 23.4 degrees. That tilt gives us seasons.',
        'The ocean covers about 71% of Earth\'s surface and holds 97% of its water.',
        'Earth\'s air is 78% nitrogen, 21% oxygen and 1% other gases.',
        'Earth formed about 4.5 billion years ago. Life began in its oceans about 3.8 billion years ago.',
        'Earth\'s inner core is a solid ball of iron and nickel, as hot as about 5,400 \u00b0C.',
    ],
};

export const QUIZ = [
    {
        q: 'Seen from the Moon\'s near side, Earth barely moves across the sky. Why?',
        options: ['The Moon spins once per orbit, so the same side always faces Earth', 'Earth is too far away to move', 'The Moon has no air'],
        a: 0,
        why: 'The Moon spins once every orbit (about 27 days). So from the near side, Earth stays in almost the same spot, with only a small wobble.',
    },
    {
        q: 'About how long is one sunrise-to-sunrise day on the Moon?',
        options: ['24 hours', 'About 29.5 Earth days', 'About 365 days'],
        a: 1,
        why: 'Sunlight lasts about two Earth weeks, then night lasts about two Earth weeks.',
    },
    {
        q: 'Why do we rank sites by UNBROKEN sunlight, not total sunlight?',
        options: ['It is easier to compute', 'Each gap is a night the lander must survive on batteries', 'Judges like big numbers'],
        a: 1,
        why: 'Six hours in one piece beats seven hours with a gap. A gap means cold and no solar power.',
    },
    {
        q: 'A lander on the far side wants to send data home. What does it need?',
        options: ['A taller antenna', 'A relay satellite, because Earth never rises there', 'Nothing, Earth is always visible'],
        a: 1,
        why: 'The far side always faces away from Earth, so Earth stays below the horizon. China\'s Chang\'e 4 used a relay satellite.',
    },
    {
        q: 'Why are missions interested in the lunar south pole?',
        options: ['It is the warmest place', 'Long sunlight on high rims, and water ice may hide in dark craters', 'It is closest to Earth'],
        a: 1,
        why: 'The Sun skims the horizon at the poles. High rims can stay sunlit a long time, while deep crater floors never see the Sun.',
    },
    {
        q: 'You raise a solar panel from 0 m to 2 m. What happens to its horizon?',
        options: ['It drops by about 0.09\u00b0, so the Sun shows a little longer', 'Nothing at all', 'It rises by 2\u00b0'],
        a: 0,
        why: 'Height lowers the horizon by acos(R / (R + h)). It is tiny, but at the poles, where the Sun skims the horizon, it can add hours.',
    },
    {
        q: 'How hot and cold does the Moon\'s surface get?',
        options: ['About 20 \u00b0C to 0 \u00b0C', 'About 127 \u00b0C in sunlight to -173 \u00b0C in darkness', 'Always -50 \u00b0C'],
        a: 1,
        why: 'With no air to hold heat, the surface swings about 300 degrees between day and night.',
    },
    {
        q: 'How much of the solar system\'s mass is in the Sun?',
        options: ['About 50%', 'About 75%', 'About 99.8%'],
        a: 2,
        why: 'Everything else, all the planets, moons and asteroids, adds up to only 0.2%.',
    },
];

export const MISSIONS = [
    {id: 'analyze', title: 'Mission control online', desc: 'Analyze sites with real NASA data', xp: 20, learn: 'Sun and Earth positions come from NASA/JPL Horizons, the same system mission planners use.'},
    {id: 'add-site', title: 'Scout', desc: 'Add a site of your own', xp: 15, learn: 'Double-click the Moon or type coordinates. Latitude is north-positive, longitude east-positive.'},
    {id: 'surface', title: 'Boots on the Moon', desc: 'Open the 3D surface view', xp: 20, learn: 'The ground is built from orbiter data: LRO laser altimetry and camera images.'},
    {id: 'walk', title: 'Moonwalker', desc: 'Walk 1 km on the Moon', xp: 30, learn: 'Apollo 17 astronauts drove about 36 km with their rover.'},
    {id: 'apollo3', title: 'Historian', desc: 'Visit 3 Apollo sites in the surface view', xp: 30, learn: 'Six Apollo missions landed between 1969 and 1972. Twelve people walked on the Moon.'},
    {id: 'heat', title: 'Thermal scan', desc: 'Use a temperature map', xp: 15, learn: 'Temperature follows the Sun angle: steep sunlight heats more than grazing sunlight.'},
    {id: 'slope', title: 'Safe landing', desc: 'Use the slope map', xp: 15, learn: 'Landers need gentle ground. Steep slopes can tip a lander over.'},
    {id: 'earth', title: 'Home planet', desc: 'Double-click Earth for Street View', xp: 20, learn: 'Earth from the Moon is about 1.9\u00b0 wide, almost 4 times wider than the Sun looks.'},
    {id: 'centers', title: 'NASA road trip', desc: 'Visit 3 NASA centers in Street View', xp: 30, learn: 'Kennedy launches, Johnson runs mission control, JPL builds robots and Goddard runs science missions.'},
    {id: 'sun', title: 'Solar observer', desc: 'Double-click the Sun', xp: 15, learn: 'NASA\'s Solar Dynamics Observatory photographs the whole Sun about every 12 seconds.'},
    {id: 'spectrum', title: 'Spectrum master', desc: 'See the Sun in all 4 views', xp: 25, learn: 'Each wavelength shows a different layer and temperature of the Sun.'},
    {id: 'need', title: 'Landing approved', desc: 'Find a site that meets your mission need', xp: 30, learn: 'A must-have filters sites out. A weight only moves them up or down.'},
    {id: 'longday', title: 'Endless day', desc: 'Find 100+ h of unbroken Sun + Earth', xp: 40, learn: 'Long unbroken sunlight means less battery, less heater power and a lighter lander.'},
    {id: 'pole', title: 'Pole position', desc: 'Analyze a site within 5\u00b0 of a pole', xp: 25, learn: 'At the poles the Sun skims the horizon all day, so a few metres of height matter.'},
    {id: 'farside', title: 'Far-side explorer', desc: 'Find a site where Earth never rises', xp: 25, learn: 'The far side is a radio-quiet place: great for radio telescopes, hard for talking to Earth.'},
    {id: 'planner', title: 'Mission planner', desc: 'Rank 6 or more sites', xp: 30, learn: 'Real teams compare dozens of sites before choosing one.'},
    {id: 'facts', title: 'Fact finder', desc: 'Read 10 NASA facts', xp: 20, learn: 'Every fact links to its NASA page.'},
    {id: 'quiz', title: 'Flight certified', desc: 'Answer every quiz question right', xp: 50, learn: 'You now know why mission planners choose sites the way they do.'},
];

const RANKS = ['Cadet', 'Pilot', 'Navigator', 'Commander', 'Mission Specialist', 'Flight Director'];
const KEY = 'apologistics-game-v1';

let state = load();
const factIndex = {moon: 0, sun: 0, earth: 0};
let currentBody = 'moon';

function load() {
    try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
            return JSON.parse(raw);
        }
    } catch (e) {
        // Storage can be blocked; the game still works for this visit.
    }
    return {xp: 0, done: {}, counters: {}, sets: {}, quiz: {}};
}

function save() {
    try {
        localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
        // ignore
    }
}

const $ = id => document.getElementById(id);

function toast(title, text) {
    const t = document.createElement('div');
    t.className = 'toast';
    const b = document.createElement('b');
    b.textContent = title;
    const s = document.createElement('span');
    s.textContent = text;
    t.append(b, s);
    $('toasts').append(t);
    setTimeout(() => t.remove(), 4200);
}

export function renderPlayer() {
    const level = Math.floor(state.xp / 100) + 1;
    $('level').textContent = `Level ${level}`;
    $('rank-title').textContent = RANKS[Math.min(RANKS.length - 1, Math.floor((level - 1) / 2))];
    $('xpfill').style.width = `${state.xp % 100}%`;
    $('xptext').textContent = `${state.xp} XP \u00b7 ${Object.keys(state.done).length}/${MISSIONS.length} missions`;
}

export function complete(id) {
    if (state.done[id]) {
        return;
    }
    const m = MISSIONS.find(x => x.id === id);
    if (!m) {
        return;
    }
    const before = Math.floor(state.xp / 100);
    state.done[id] = Date.now();
    state.xp += m.xp;
    save();
    toast(`${m.title}  +${m.xp} XP`, m.learn);
    if (Math.floor(state.xp / 100) > before) {
        setTimeout(() => toast('Level up!', `You are now level ${Math.floor(state.xp / 100) + 1}.`), 600);
    }
    renderPlayer();
    renderMissions();
}

/** Count something; finish a mission when the count reaches a target. */
export function count(name, target, missionId, amount = 1) {
    state.counters[name] = (state.counters[name] || 0) + amount;
    save();
    if (state.counters[name] >= target) {
        complete(missionId);
    }
}

/** Remember distinct items (e.g. visited sites); finish a mission at a target size. */
export function collect(name, item, target, missionId) {
    const set = new Set(state.sets[name] || []);
    set.add(item);
    state.sets[name] = [...set];
    save();
    if (set.size >= target) {
        complete(missionId);
    }
    return set.size;
}

export function factHtml(body, i) {
    return {text: FACTS[body][i % FACTS[body].length], src: SRC[body]};
}

export function showFact(body) {
    currentBody = body;
    const f = factHtml(body, factIndex[body]++);
    $('fact-body-name').textContent = `NASA fact \u00b7 ${body[0].toUpperCase() + body.slice(1)}`;
    $('fact-text').textContent = f.text;
    $('fact-src').href = f.src;
    $('fact').hidden = false;
    count('facts', 10, 'facts');
}

export function fillFactCard(el, body) {
    const f = factHtml(body, factIndex[body]++);
    el.innerHTML = '';
    const s = document.createElement('small');
    s.textContent = 'NASA fact';
    const p = document.createElement('div');
    p.textContent = f.text;
    const a = document.createElement('a');
    a.href = f.src;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Source: NASA';
    a.style.fontSize = '11px';
    el.append(s, p, a);
    count('facts', 10, 'facts');
}

export function renderMissions() {
    const list = $('mission-list');
    if (!list) {
        return;
    }
    list.innerHTML = '';
    for (const m of MISSIONS) {
        const d = document.createElement('div');
        d.className = 'mission' + (state.done[m.id] ? ' done' : '');
        const em = document.createElement('em');
        em.textContent = `+${m.xp} XP`;
        const b = document.createElement('b');
        b.textContent = m.title;
        const s = document.createElement('span');
        s.textContent = state.done[m.id] ? m.learn : m.desc;
        d.append(em, b, s);
        list.append(d);
    }
    const h = document.createElement('h3');
    h.textContent = 'Flight certification quiz';
    h.style.gridColumn = '1 / -1';
    h.style.marginTop = '14px';
    list.append(h);
    QUIZ.forEach((item, qi) => {
        const d = document.createElement('div');
        d.className = 'mission' + (state.quiz[qi] ? ' done' : '');
        const b = document.createElement('b');
        b.textContent = item.q;
        d.append(b);
        if (state.quiz[qi]) {
            const s = document.createElement('span');
            s.textContent = item.why;
            d.append(s);
        } else {
            item.options.forEach((opt, oi) => {
                const btn = document.createElement('button');
                btn.textContent = opt;
                btn.style.display = 'block';
                btn.style.width = '100%';
                btn.style.textAlign = 'left';
                btn.style.marginTop = '6px';
                btn.onclick = () => {
                    if (oi === item.a) {
                        state.quiz[qi] = true;
                        state.xp += 10;
                        save();
                        toast('Correct!  +10 XP', item.why);
                        if (QUIZ.every((_, k) => state.quiz[k])) {
                            complete('quiz');
                        }
                        renderPlayer();
                        renderMissions();
                    } else {
                        btn.disabled = true;
                        toast('Not quite', 'Try another answer.');
                    }
                };
                d.append(btn);
            });
        }
        list.append(d);
    });
}

export function initGame() {
    $('fact-close').onclick = () => {
        $('fact').hidden = true;
    };
    $('fact-next').onclick = () => showFact(currentBody);
    $('reset-xp').onclick = () => {
        state = {xp: 0, done: {}, counters: {}, sets: {}, quiz: {}};
        save();
        renderPlayer();
        renderMissions();
    };
    renderPlayer();
    renderMissions();
}
