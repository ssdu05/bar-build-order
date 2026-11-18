-- Run from the project directory: lua bar_plugins/tests/recorder_export_smoke.lua
-- All game APIs and file writes are mocked; no BAR installation is modified.
local frame = 0
local files = {}
local messages = {}
local exportDir = "LuaUI/Config/RealBO/"
local directoryCreated = false
local action
local clipboard
local statsCallbacks
local unsubscribed = false
WG = {teamStats = {
    subscribe = function(name, callbacks)
        assert(name == "RealBO")
        statsCallbacks = callbacks
        callbacks.live({[0] = {valueArmy = 600, valueAir = 100, valueSea = 0, buildPower = 200, buildPowerActive = 100}}, frame)
    end,
    unsubscribe = function(name) assert(name == "RealBO"); unsubscribed = true end,
}}
widget = {}
Game = {gameSpeed = 30, gameName = "BAR", gameVersion = "test", mapName = "Test Map"}
UnitDefs = {
    [1] = {isBuilding = true, humanName = "", name = "armmex"},
    [2] = {isBuilding = false, humanName = "", name = "armcom"},
    [3] = {isBuilding = false, isFactory = true, humanName = "Bot Lab", name = "armlab"},
    [4] = {isBuilding = false, humanName = "Pawn", name = "armpw", speed = 60,
        weapons = {{weaponDef = 1}}, metalCost = 50, energyCost = 600},
}
Spring = {
    GetGameFrame = function() return frame end,
    GetUnitPosition = function() return 100, 0, 200 end,
    GetUnitBuildFacing = function() return 0 end,
    GetPlayerList = function(team) return {team} end,
    GetPlayerInfo = function(player) return "Player" .. player, "", false end,
    GetTeamInfo = function(team) return team, nil, false, false, "", 0 end,
    GetTeamList = function() return {0, 1, 99} end,
    GetTeamResources = function(team, resource) return 100 + team, 1000, 0, resource == "metal" and 5 or 50, 3 end,
    GetTeamResourceStats = function() return 10, 20, 1, 2, 3 end,
    GetTeamDamageStats = function() return 500, 100 end,
    GetTeamUnitStats = function() return 4, 2 end,
    GetUnitDefID = function(id) return id == 105 and 3 or 2 end,
    Echo = function(message) messages[#messages + 1] = message end,
    IsReplay = function() return true end,
    GetGaiaTeamID = function() return 99 end,
    GetReplayFilePath = function() return "demos/test.sdfz" end,
    SetClipboard = function(text) clipboard = text end,
    CreateDir = function(path)
        assert(path == exportDir, "Only the dedicated Config subfolder may be created")
        directoryCreated = true
        return true
    end,
}
widgetHandler = {AddAction = function(self, name, callback) action = callback end}
io = {open = function(path)
    assert(directoryCreated, "Create the export directory before opening any file")
    assert(path:sub(1, #exportDir) == exportDir, "All files must be written in Config/RealBO/")
    return {write = function(self, text) files[path] = text; return self end, close = function() end}
end}
dofile("bar_plugins/LuaUI/Widgets/gui_real_build_order_recorder.lua")
widget:Initialize()

frame = 30
widget:UnitCreated(101, 1, 0, nil) -- nil builder must not shorten the CSV either
widget:UnitCreated(102, 1, 0, nil)
widget:UnitCreated(103, 1, 0, 900)
widget:UnitCreated(104, 1, 0, nil)
widget:UnitCreated(105, 3, 0, 900) -- factories belong to buildings, even if isBuilding is false
widget:UnitCreated(106, 4, 0, 105) -- factory-produced mobile unit
widget:UnitCreated(107, 4, 0, 105) -- cancelled before completion
widget:UnitCreated(108, 4, 99, 105) -- Gaia remains excluded
widget:UnitCreated(109, 999, 0, nil) -- invalid definition is ignored
frame = 60
widget:UnitFinished(101, 1, 0)
widget:UnitFinished(103, 1, 0)
widget:UnitFinished(105, 3, 0)
widget:UnitFinished(106, 4, 0)
widget:UnitGiven(101, 1, 1, 0)
frame = 90
widget:UnitDestroyed(103, 1, 0)
widget:UnitDestroyed(104, 1, 0)
widget:UnitDestroyed(106, 4, 0)
widget:UnitDestroyed(107, 4, 0)
action("realbo", "export")
assert(files[exportDir .. "realbo_test_all_units_buildings.csv"]:find('"under_construction"', 1, true))
assert(files[exportDir .. "realbo_test_summary.json"]:find('"game_over": false', 1, true))
widget:GameOver({0})

local function rows(text)
    local result = {}
    for line in text:gmatch("[^\r\n]+") do
        local fields = {}
        for cell in line:gmatch('"([^"]*)"') do fields[#fields + 1] = cell end
        assert(#fields == 26, "Every exported record must have exactly 26 columns, even with nil holes")
        result[#result + 1] = fields
    end
    return result
end
local all = rows(files[exportDir .. "realbo_test_all_units_buildings.csv"])
assert(#all == 8)
local summary = files[exportDir .. "realbo_test_summary.json"]
assert(summary:find('"format": "realbo_summary"', 1, true))
assert(not summary:find('"notes"', 1, true), "Summary exports must not include notes")
assert(summary:find('"game_over": true', 1, true))
assert(summary:find('"started": 7', 1, true) and summary:find('"completed": 4', 1, true))
assert(summary:find('"buildings": 5', 1, true) and summary:find('"units": 2', 1, true))
assert(summary:find('"removed_before_completion": 2', 1, true) and summary:find('"unfinished": 1', 1, true))
local expectedFiles = {
    [exportDir .. "realbo_test_all_units_buildings.csv"] = true,
    [exportDir .. "realbo_test_summary.json"] = true,
    [exportDir .. "realbo_test_unit_defs.json"] = true,
    [exportDir .. "realbo_test_statistics.json"] = true,
}
local count = 0
for path in pairs(files) do
    assert(expectedFiles[path], "Unexpected output: " .. path)
    count = count + 1
end
assert(count == 4, "One CSV, summary, statistics, and detailed unit definitions should be written")
local stats = files[exportDir .. "realbo_test_statistics.json"]
assert(stats:find('"format": "realbo_statistics"', 1, true))
assert(stats:find('"game_over": true', 1, true))
assert(stats:find('"sample_period_frames": 150', 1, true))
assert(stats:find('"team_id":0,"ally_team_id":0,"player":"Player0"', 1, true))
assert(stats:find('"team_id":1,"ally_team_id":0,"player":"Player1"', 1, true))
assert(not stats:find('"team_id":99', 1, true), "Gaia must not enter statistics")
assert(stats:find('600,100,0', 1, true), "Rich API values must be retained")
assert(stats:find('null', 1, true), "Missing metrics must be null, not fabricated zeroes")
assert(files[exportDir .. "realbo_test_unit_defs.json"]:find('"metal_cost": 50, "energy_cost": 600, "category": "army"', 1, true))
assert(all[1][26] == "unit_kind")
assert(all[2][4] == "finished" and all[2][21] == "60" and all[2][22] == "")
assert(all[2][11] == "" and all[2][23] == "Player1")
assert(all[3][4] == "unfinished_at_end" and all[3][21] == "" and all[3][22] == "")
assert(all[4][4] == "finished_then_removed" and all[4][21] == "60" and all[4][22] == "90")
assert(all[5][4] == "removed_before_completion" and all[5][21] == "" and all[5][22] == "90")
for index = 2, 5 do
    assert(all[index][7] == "armmex", "Empty humanName must fall back to the internal name")
end
for index = 2, #all do
    assert(all[index][24] == "Test Map" and all[index][25] == "demos/test.sdfz")
end
assert(all[6][26] == "building" and all[6][7] == "Bot Lab")
assert(all[7][26] == "unit" and all[7][11] == "105" and all[7][4] == "finished_then_removed")
assert(all[7][12] == "Bot Lab", "Factory producer must be recorded as the unit's builder")
assert(all[8][26] == "unit" and all[8][4] == "removed_before_completion")
-- Reused engine IDs retain the old record and create a new production event.
frame = 120
widget:UnitCreated(106, 4, 0, 105)
frame = 150
widget:UnitFinished(106, 4, 0)
action("realbo", "export")
local reused = rows(files[exportDir .. "realbo_test_all_units_buildings.csv"])
assert(#reused == 9 and reused[7][22] == "90" and reused[9][20] == "120" and reused[9][21] == "150")
assert(all[4][12] == "armcom", "Builder name must also fall back when humanName is empty")
action("realbo", "copy")
assert(clipboard == files[exportDir .. "realbo_test_all_units_buildings.csv"])
action("realbo", "copyunitmap")
assert(clipboard == files[exportDir .. "realbo_test_unit_defs.json"])
-- A sandbox/API error must not prevent writing to an already existing folder.
Spring.CreateDir = function() error("directory API blocked") end
action("realbo", "export")
-- A rewind must clear the former run's statistics, not leak future samples.
widget:GameFrame(frame)
frame = 0
widget:GameFrame(frame)
action("realbo", "export")
stats = files[exportDir .. "realbo_test_statistics.json"]
assert(not stats:find('"frame":90', 1, true))
assert(stats:find('"full_replay_captured": false', 1, true))
-- Old game versions still provide economy samples without the optional BAR API.
WG.teamStats = nil
frame = 150
widget:GameFrame(frame)
action("realbo", "export")
assert(unsubscribed)
stats = files[exportDir .. "realbo_test_statistics.json"]
assert(stats:find('"frame":150,"values":[5,3,100,1000,50,3,100,1000,20,10,1,3,2', 1, true))
-- When creation is unavailable and the folder is missing, report the path
-- rather than crash or silently fall back to writing in Config itself.
local attempts = 0
io.open = function(path)
    assert(path:sub(1, #exportDir) == exportDir)
    attempts = attempts + 1
    return nil, "folder missing"
end
Spring.CreateDir = nil
action("realbo", "export")
assert(attempts == 1, "A failed write must stop the export without a root-directory fallback")
assert(messages[#messages]:find(exportDir, 1, true), "Export errors must identify the folder to create manually")
print("PASS: safe exports, four outputs, lifecycle events, costs, per-player economy/rich statistics, rewind and old-version fallback")
return files
