**What this is**
scraping and tracking data on bot movements on Slack's App Directory

- Day-to-day changes in bot positions (new and interesting bots gaining traction? losing steam?)
- Detailed information on specific bot (bot owner? description? download link? rankings?)

**To-Do**
write script to run the following in order

(1) Download data from the day for each category
```
resolveRequestToFile(
  './daily/' + getDate() + '.json', 
  fetchAllBots(require('./categories.json')))
```

(2) Look through current day's scrape and add any new bots never seen before to master bot file
```
updateBotList(
  './daily/' + getDate() + '.json', 
  require('./bots.json'))
```

(3) Enqueue new bots 
```
checkBotListForIncompletes(
  require('./bots.json'), 
  require('./queue.json'))
```

(4) Download detailed data for bots in queue
```
fetchDetailsForAllBots(
  require('./bots.json'), 
  require('./queue.json')) 
  .then(function (updates) { 
    let updatedList = updateDetailsForBots(updates, require('./bots.json'))
    writeFileAsync('./bots.json', JSON.stringify(updatedList)) 
  })