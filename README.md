# Epicenter, visually

An interactive page for our DS4400 earthquake puzzle: find where a quake
started from how long its shaking took to reach each seismograph station,
then see how accurate that is as you drag the number of stations, their
spacing, the timing noise and the wave speed.

- **How we find it**: one simulated quake. The map shades the timing
  mismatch *J* everywhere, and you can play our guess's walk downhill on
  *J* step by step. Under the map, "Miss after each step" shows how far the
  guess is from the true epicenter at every step, for this quake (orange)
  and 4 more with the same settings (gray).
- **How accurate is it?**: many simulated quakes, one dot per quake at its
  miss (km from our final guess to the true epicenter). Gray dots use the
  prompt's default settings (10 stations, 50 km, 0.2 s, 6 km/s), and blue
  dots use yours. Hover a dot to preview that quake, or open it step by step.
  "Miss against timing noise" reruns your blue quakes at timing noise 0,
  0.1, 0.2, 0.5, 1 and 2 s (plus yours), changing nothing else.

The wave speed slider (1 to 12 km/s) changes how fast the simulated shaking
travels. As in the Python code (`estimate(quake.x, quake.t, quake.speed)`),
the estimator is told the speed.

## The method

`js/quake.js` is a line-for-line port of our Python estimator:

    J(g)  = 1/n sum_i (||g - s_i|| / v - t_i)^2
    dJ(g) = 1/n sum_i 2 e_i (g - s_i) / (||g - s_i|| v),  e_i = ||g - s_i|| / v - t_i
    g <- g - alpha dJ(g),  alpha = v^2

The step size is the wave speed squared (36 at 6 km/s). The walk starts
1 km off (in x and in y) the station that felt the shaking first and stops
once a step moves the guess less than 0.001 km, or after 1,000 steps; where
it stops is the estimate. On the same station data it gives the same
guesses as the Python code (version 2) to within rounding, in the same
number of steps.

The quakes follow the course simulator's recipe (stations and epicenter
are n + 1 draws from one bell curve, and each delay is distance / speed
plus timing noise, never below 0). The page draws its own random numbers,
so quake k here is not `Earthquake(seed=k)`.

## Run it

Open `index.html` in a browser, or serve the folder:

    python3 -m http.server 8000

and visit <http://localhost:8000>. No build step and no libraries.

## Publish it (after the puzzle is due)

The repo starts private. To turn on the website at
`https://yongqi04.github.io/quake-explorer/`:

    gh repo edit --visibility public --accept-visibility-change-consequences
    gh api -X POST "repos/{owner}/{repo}/pages" -f "source[branch]=main" -f "source[path]=/"
