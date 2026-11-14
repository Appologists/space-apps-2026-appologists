# Lunar Landing Planner

A browser app: spin a real NASA Moon, pick a landing site, drop into a first-person
"Street View" with live Sun/Earth position, shadows, and a 7-day sunlight timeline.

## Files
- index.html       – the whole app (HTML + CSS + JavaScript, uses three.js from a CDN)
- moon_color.jpg   – NASA SVS LROC color mosaic (4K)
- moon_normal.jpg  – relief map made from NASA LOLA elevation data

## Run it on your laptop
Open a terminal in this folder and run:

    npx serve .

Then open the link it prints (usually http://localhost:3000).
(Double-clicking index.html won't load the Moon images — browsers block that. Use a server.)

## Put it online (pick one)
- Netlify Drop: go to app.netlify.com/drop and drag this whole folder onto the page.
- Vercel: in this folder run `npx vercel` and press Enter through the questions.
- GitHub Pages: push the folder to a repo → Settings → Pages → deploy from the main branch.

Credit: Moon imagery from NASA's Scientific Visualization Studio (LROC WAC mosaic, LOLA elevation).
