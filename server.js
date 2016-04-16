'use strict'

let Promise = require('bluebird')
let fs = require('fs')
let request = require('request-promise')
let cheerio = require('cheerio')
let toMarkdown = require('to-markdown')

let BASE_URI = 'https://slack.com'

// *** DEDICATED SPACE FOR RUNNING RANDOM SCRIPTS ***
//
//
//
// *** END SPACE

/*
* Role: adds bots with incomplete information to queue
* @param { SAVED_BOTS } key-value map { botname: { botData }, ... }
* @param { BOT_QUEUE } key-value map { botName: botUrl, ... }
* Output: JSON file
*/
function checkBotListForIncompletes (SAVED_BOTS, BOT_QUEUE) {
  let queue = {}

  for (let bot in SAVED_BOTS) {
    let description = SAVED_BOTS[bot].description
    if (!description && !BOT_QUEUE[bot]) {
      queue[bot] = SAVED_BOTS[bot].url
    }
  }

  writeFileAsync('./queue.json', JSON.stringify(queue))
}

/*
* Role: adds new bots to bots list by checking all snapshots from a given day
* @param { path } string, path to JSON file
* @param { SAVED_BOTS } key-value map { botname: { botData }, ... }
* @param { snapshot } object {[date: string, category: {}, results: [{bot}, ...], ...]}
* Output: object {name: string, url: string, tagline: string, description: string, tags: array, categories: array}
*/
function updateBotList (path, SAVED_BOTS) {
  let snapshot = require(path)
  let changesDetected = false

  // loop through each bot of each category
  snapshot.forEach(function (category) {
    let results = category.results
    results.forEach(function (bot) {
      // save bot if not yet saved
      if (!SAVED_BOTS[bot.name]) {
        changesDetected = true
        SAVED_BOTS[bot.name] = buildBotFromSnapshot(bot)
      }
    })
  })

  // rewrite file with updated list
  if (changesDetected) {
    writeFileAsync('./bots.json', JSON.stringify(SAVED_BOTS))
  }
}

/*
* Role: builds new bot metadata
* @param { bot } string
* Output: object { name: string, url: string, tagline: string, description: string, tags: array, categories: array }
*/
function buildBotFromSnapshot (bot) {
  return {
    name: bot.name,
    url: bot.url,
    tagline: bot.tagline,
    categories: [],
    description: '',
    site: ''
  }
}

/*
* Role: builds Cheerio parsing options to integrate with Request module
* @param { url } string
* @param { options } object
* @param { transform } fn => Request pipes response which is then transformed into Cheerio DOM
* Output: DOM object
*/
function getOptions (url) {
  return {
    uri: url,
    transform: function (body) {
      return cheerio.load(body)
    }
  }
}

/*
* Role: gets detailed information for all queued bots
* @param { SAVED_BOTS } key-value map { botname: { botData }, ... }
* @param { BOT_QUEUE } key-value map { botName: botUrl, ... }
* Output: Promise => Resolves: json object
*/
function fetchDetailsForAllBots (SAVED_BOTS, BOT_QUEUE) {
  return new Promise(function (resolve, reject) {
    let queuedBots = Object.keys(BOT_QUEUE)
    let results = []
    queuedBots.forEach(function (bot) {
      results.push(fetchDetailsForOneBot(bot, SAVED_BOTS, BOT_QUEUE))// resolves with updated values
    })

    Promise.all(results)
    .then(function (results) {
      resolve(results)
    })
    .catch(function (err) {
      reject(err)
    })
  })
}

/*
* Role: updates key-value mapping in master bots list from updates array
* @param { SAVED_BOTS } key-value map { botname: { botData }, ... }
* @param { updates } array of updated bots [ {name: string, categories: [], ... }, ... ]
* Output: JSON object
*/
function updateDetailsForBots (updates, SAVED_BOTS) {
  updates.forEach(function (update) {
    SAVED_BOTS[update.name] = update
  })
  return SAVED_BOTS
}

/*
* Role: makes a request to get detailed information about a specific bot
* @param { name } string => name of bot
* @param { bot_queue } key-value map { botName: botUrl, ... }
* Output: Promise => Resolves: json object
*/
function fetchDetailsForOneBot (name, saved_bots, bot_queue) {
  return new Promise(function (resolve, reject) {
    makeRequest(bot_queue[name])
    .then(function ($) {
      resolve(parseDetailedBotData($, name, saved_bots))
    })
    .catch(function (err) {
      reject(err)
    })
  })
}

/*
* Role: finds tags, description, install link, and avatar image for bot
* @param { $ } Cheerio-built DOM object
* @param { name } string => name of bot
* @param { saved_bots } key-value map { botname: { botData }, ... }
* Output: JSON object
*/
function parseDetailedBotData ($, name, saved_bots) {
  let botCopy = JSON.parse(JSON.stringify(saved_bots[name])) // deep copy to prevent mutation
  let defaultEntry = 'null'

  let description = $('.tsf_output').html() || defaultEntry
  let site = $('.single_install_button a').first().attr('href') || defaultEntry

  let categories = []
  $('.tag').each(function (i, el) {
    let categoryName = toMarkdown($(this).html().trim())
    let categoryUrl = BASE_URI + $(this).attr('href')
    categories.push({ name: categoryName, url: categoryUrl })
  })

  // update entries
  botCopy.description = toMarkdown(description)
  botCopy.categories = categories
  botCopy.site = site

  // logging
  console.log('[PROCESSED]', name)

  return botCopy
}

/*
* Role: makes a request to get each bot in each category group and returns bots in JSON object
* @param { SAVED_CATEGORIES } key-value map { categoryName: categoryUrl, ... }
* Output: Promise => Resolves: json object
*/
function fetchAllBots (SAVED_CATEGORIES) {
  return new Promise(function (resolve, reject) {
    let results = []
    let categoryNames = Object.keys(SAVED_CATEGORIES)

    categoryNames.forEach(function (category) {
      results.push(fetchBotsFromCategory(category, SAVED_CATEGORIES))
    })

    Promise.all(results)
    .then(function (results) {
      resolve(results)
    })
    .catch(function (err) {
      reject(err)
    })
  })
}

/*
* Role: makes a request to apps directory and returns categories in JSON object
* Output: Promise => Resolves: json object
*/
function fetchCategoryNames () {
  return new Promise(function (resolve, reject) {
    makeRequest(BASE_URI + '/apps')
      .then(function ($) {
        let categories = getSelectionFromPage($, '.titled_list ul li a')
        resolve(parseAllCategories($, categories))
      })
      .catch(function (err) {
        reject(err)
      })
  })
}

/*
* Role: makes a request to specific category and returns bots in JSON object
* @param { saved_categories } key-value map { categoryName: categoryUrl, ... }
* Output: Promise => Resolves: json object
*/
function fetchBotsFromCategory (categoryName, saved_categories) {
  return new Promise(function (resolve, reject) {
    makeRequest(saved_categories[categoryName])
    .then(function ($) {
      let bots = getSelectionFromPage($, '.media_list li a')
      resolve(parseAllBots($, bots, categoryName, saved_categories))
    })
    .catch(function (err) {
      reject(err)
    })
  })
}

/*
* Role: constructs categories JSON from given DOM selection
* @param { $ } Cheerio-built DOM object
* @param { categories } array of DOM selections
* Output: JSON object
*/
function parseAllCategories ($, categories) {
  if (!categories) return {}

  let json = {}
  categories.each(function (i, el) {
    let category = $(this)
    let categoryName = toMarkdown(category.html())
    let categoryUrl = BASE_URI + category.attr('href')
    json[categoryName] = categoryUrl
  })
  return json
}

/*
* Role: parses data for each bot in DOM selection
* @param { $ } Cheerio-built DOM object
* @param { bots } array of DOM selections
* @param { categoryName } string
* @param { saved_categories } key-value map { categoryName: categoryUrl, ... }
* Output: JSON object
*/
function parseAllBots ($, bots, categoryName, saved_categories) {
  if (!bots) return {}

  let json = {
    date: getDate(),
    category: { 'url': saved_categories[categoryName], 'name': categoryName },
    results: []
  }

  bots.each(function (i, el) {
    let bot = $(this)
    let botData = parseOneBot($, i, bot)
    json.results.push(botData)
  })

  return json
}

/*
* Role: constructs bots JSON from given DOM selection
* @param { $ } Cheerio-built DOM object
* @param { index } int
* @param { bot } DOM element
* Output: botData { name: string, url: string, tagline: string, rank: int }
*/
function parseOneBot ($, index, bot) {
  let name = toMarkdown(bot.find('span').first().html())
  let url = BASE_URI + bot.attr('href')
  let tagline = toMarkdown($(bot.find('span')[1]).html())
  let rank = index + 1

  return {
    name: name,
    url: url,
    tagline: tagline,
    rank: rank
  }
}

/*
* Role: gets current date and formats it to yyyy/m/d
* Output: string
*/
function getDate () {
  let date = new Date()
  return [ date.getFullYear(), date.getMonth() + 1, date.getDate() ].join('_')
}

/*
* Role: selects target class(es) from DOM => ex. $('.target-class li')
* @param { $ } Cheerio-built DOM object
* Output: array of DOM selections
*/
function getSelectionFromPage ($, targetClass) {
  return $(targetClass)
}

/*
* Role: makes a request with the specified Cheerio integration options
* @param { url } string
* Output: Promise => Resolves: Cheerio-loaded DOM ($)
*/
function makeRequest (url) {
  return request(getOptions(url))
}

// *** THESE WRITE FUNCTIONS WILL BE REFACTORED  ***
// ***     TO INCORPORATE A MYSQL DATABASE       ***

/*
* Role: writes response data to file
* @param { file } string
* @param { resolvedRequest } Promise => Resolves: JSON object
* Output: Resolved Promise
*/
function resolveRequestToFile (file, resolvedRequest) {
  resolvedRequest
  .then(function (data) {
    return writeFileAsync(file, JSON.stringify(data))
  })
  .then(function (data) {
    console.log(data)
  })
  .catch(function (err) {
    console.error(err)
  })
}

/*
* Role: Promisified fs.writeFile method
* @param { file } string
* @param { contents } string
* Output: Promise => Resolves: Contents (string)
*/
function writeFileAsync (file, contents) {
  return new Promise(function (resolve, reject) {
    fs.writeFile(file, contents, function (err) {
      if (err) {
        reject(err)
      } else {
        resolve(contents)
      }
    })
  })
}