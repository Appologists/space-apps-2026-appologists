// Shared shapes for criteria. JSDoc only: there is nothing to import at run time.

/**
 * A criterion scores one site for one mission.
 *
 * @typedef {Object} Criterion
 * @property {string} id                 short unique id, used as the key for weights and results
 * @property {string} label              name shown in the app
 * @property {string} description        one sentence: what is measured and why it matters
 * @property {'ready'|'planned'} status  'planned' criteria are listed in the app but not scored
 * @property {number} defaultWeight      0–1, how much it counts until the user moves the slider
 * @property {string} [needs]            for planned criteria: the data or work that is missing
 * @property {(site: import('../astro/sky.js').Site & {id: string, name: string}, ctx: Context) => Result} evaluate
 */

/**
 * @typedef {Object} Result
 * @property {number|null} score     0 (worst) to 1 (best); null means "no data", which is never treated as 0
 * @property {number|null} value     the headline number in real units
 * @property {string} [unit]
 * @property {string} summary        one line for the ranking list
 * @property {Object<string, number|string|boolean|null>} [facts]  extra numbers for the detail view
 * @property {string[]} [caveats]    what this number leaves out; shown to the user
 */

/**
 * @typedef {Object} Context
 * @property {import('../mission.js').Mission} mission
 * @property {number} stepHours
 * @property {(site: import('../astro/sky.js').Site) => ReturnType<import('../astro/sky.js').skySeries>} sky
 *           Sun/Earth elevation series for a site over the mission window (cached per site)
 */

export const noData = (summary, extra = {}) => ({ score: null, value: null, summary, ...extra });
