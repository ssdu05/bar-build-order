-- Beyond All Reason / Recoil replay-only building and unit recorder.
-- License: MIT. Install in your BAR data folder under LuaUI/Widgets/.
-- The widget records SIMULATION events, not queued commands or screen images.

function widget:GetInfo()
    return {
        name = "Real Build Order Recorder",
        desc = "Replay recorder: actual buildings and units plus version-matched unit ID/name JSON",
        author = "ssdu05",
        date = "2026-11-09",
        license = "MIT",
        layer = 0,
        enabled = true,
        handler = true,
    }
end

local spGetGameFrame = Spring.GetGameFrame
local spGetUnitPosition = Spring.GetUnitPosition
local spGetUnitBuildFacing = Spring.GetUnitBuildFacing
local spGetPlayerInfo = Spring.GetPlayerInfo
local spGetPlayerList = Spring.GetPlayerList
local spGetTeamInfo = Spring.GetTeamInfo
local spEcho = Spring.Echo
local FPS = (Game and Game.gameSpeed) or 30
local PREFIX = "[RealBO] "
local EXPORT_DIR = "LuaUI/Config/RealBO/"

local recording = false
local gameOver = false
local startedFrame = 0
local lastFrame = 0
local skippedFrames = false
local rewindDetected = false
local records = {}
local byUnitID = {}
local teamNames = {}
local fileBase = "replay"
local replayFile = ""
local lastSavedSignature = ""
local dirty = false
local showOverlay = true
local gaiaTeamID = nil
local unitMapSaved = false
local statsTeams = {}
local statsCount, statsBytes = 0, 0
local statsTruncated = false
local statsLive, statsLiveFrame
local statsAPI
local STATS_PERIOD = FPS * 5
local STAT_KEYS = {
    "metalIncome", "metalExpense", "metalCurrent", "metalStorage",
    "energyIncome", "energyExpense", "energyCurrent", "energyStorage",
    "metalProduced", "metalUsed", "metalExcess", "metalSent", "metalReceived",
    "energyProduced", "energyUsed", "energyExcess", "energySent", "energyReceived",
    "metalReclaimed", "energyReclaimed", "metalReclaimIncome", "energyReclaimIncome",
    "damageDealt", "damageReceived", "unitsProduced", "unitsKilled", "unitsDied",
    "unitValue", "valueArmy", "valueAir", "valueSea", "valueDefense",
    "valueStrategic", "valueFactories", "valueBuilders", "valueEconomy", "valueUtility",
    "killedValue", "lostValue", "buildPower", "buildPowerActive", "buildPowerIdle",
    "convUse", "convCapacity", "idleCons", "cons", "idleLabs", "labs",
    "metalSpots", "geoSpots", "incomeMex", "incomeConverters",
    "incomeWind", "incomeSolar", "incomeTidal", "incomeGeo", "incomeFusion",
}

local function echo(msg)
    spEcho(PREFIX .. msg)
end

local function currentFrame()
    return spGetGameFrame() or 0
end

local function secs(frame)
    if frame == nil then return "" end
    return string.format("%.3f", frame / FPS)
end

local function timecode(frame)
    if frame == nil then return "" end
    local hundredths = math.floor(frame * 100 / FPS + 0.5)
    local minutes = math.floor(hundredths / 6000)
    local remain = hundredths % 6000
    return string.format("%02d:%02d.%02d", minutes, math.floor(remain / 100), remain % 100)
end

local function csvCell(value)
    if value == nil then value = "" end
    return '"' .. tostring(value):gsub('"', '""') .. '"'
end

local function jsonString(value)
    local str = tostring(value or "")
    return '"' .. str:gsub('[%c\\"]', function(ch)
        if ch == '"' then return '\\"' end
        if ch == '\\' then return '\\\\' end
        if ch == '\n' then return '\\n' end
        if ch == '\r' then return '\\r' end
        if ch == '\t' then return '\\t' end
        return string.format('\\u%04x', string.byte(ch))
    end) .. '"'
end

local function csvLine(fields, count)
    local out = {}
    -- Sparse record tables contain nil frame/builder values. #fields is not a
    -- reliable column count for them; emit every declared column explicitly.
    for i = 1, count or #fields do
        out[i] = csvCell(fields[i])
    end
    return table.concat(out, ",")
end

local function teamName(teamID)
    if teamNames[teamID] then return teamNames[teamID] end
    if gaiaTeamID ~= nil and teamID == gaiaTeamID then
        teamNames[teamID] = "Gaia"
        return "Gaia"
    end
    local players = spGetPlayerList and spGetPlayerList(teamID) or {}
    local names = {}
    if players then
        for _, playerID in ipairs(players) do
            local name, _, spectator = spGetPlayerInfo(playerID, false)
            if name and name ~= "" and not spectator then
                names[#names + 1] = name
            end
        end
    end
    if #names > 0 then
        teamNames[teamID] = table.concat(names, " + ")
        return teamNames[teamID]
    end
    local _, _, _, hasAI = spGetTeamInfo(teamID, false)
    teamNames[teamID] = (hasAI and hasAI ~= 0) and ("AI team " .. tostring(teamID)) or ("Team " .. tostring(teamID))
    return teamNames[teamID]
end

local function isStructure(unitDefID)
    local ud = UnitDefs[unitDefID]
    return ud and (ud.isBuilding or ud.isFactory)
end

local function unitCategory(ud)
    local cp = ud.customParams or {}
    local group = cp.unitgroup
    if ud.isFactory then return "factories" end
    if ud.isBuilder then return "builders" end
    if group == "nuke" or group == "antinuke" or cp.islrpc then return "strategic" end
    if group == "energy" or group == "metal" then return "economy" end
    if group == "util" then return "utility" end
    local combatGroup = {weapon = true, aa = true, sub = true, emp = true, explo = true, weaponaa = true, weaponsub = true}
    local armed = (ud.weapons and #ud.weapons > 0) or combatGroup[group]
    if (ud.speed or 0) == 0 then return armed and "defense" or "utility" end
    if ud.canFly then return "air" end
    if ud.moveDef and Game.speedModClasses and ud.moveDef.smClass == Game.speedModClasses.Ship then return "sea" end
    return armed and "army" or "utility"
end

local function jsonNumber(value)
    if type(value) ~= "number" or value ~= value or value == math.huge or value == -math.huge then
        return "null"
    end
    return string.format("%.9g", value)
end

local function subscribeStats()
    local api = WG and WG.teamStats
    if api == statsAPI then return end
    if statsAPI then statsAPI.unsubscribe("RealBO") end
    statsAPI = api
    statsLive, statsLiveFrame = nil, nil
    if api then
        api.subscribe("RealBO", {
            live = function(all, frame) statsLive, statsLiveFrame = all, frame end,
            reset = function()
                statsLive, statsLiveFrame = nil, nil
                -- Never mix counters from two gadget runs without a capture warning.
                skippedFrames = true
            end,
        })
    end
end

local function captureStats(force)
    if not recording then return end
    local frame = currentFrame()
    if not force and frame % STATS_PERIOD ~= 0 then return end
    subscribeStats()
    for _, teamID in ipairs(Spring.GetTeamList and Spring.GetTeamList() or {}) do
        if teamID ~= gaiaTeamID then
            local values = {}
            -- Rich BAR stats are optional; never fabricate absent values as zero.
            local live = statsLive and statsLiveFrame and frame >= statsLiveFrame
                and frame - statsLiveFrame <= FPS * 2 and statsLive[teamID]
            if live then
                for _, key in ipairs(STAT_KEYS) do values[key] = live[key] end
            end
            if Spring.GetTeamResources then
                for _, resource in ipairs({"metal", "energy"}) do
                    local current, storage, _, income, expense = Spring.GetTeamResources(teamID, resource)
                    values[resource .. "Current"] = current
                    values[resource .. "Storage"] = storage
                    values[resource .. "Income"] = income
                    values[resource .. "Expense"] = expense
                end
            end
            if Spring.GetTeamResourceStats then
                for _, resource in ipairs({"metal", "energy"}) do
                    local used, produced, excess, received, sent = Spring.GetTeamResourceStats(teamID, resource)
                    values[resource .. "Used"] = used
                    values[resource .. "Produced"] = produced
                    values[resource .. "Excess"] = excess
                    values[resource .. "Received"] = received
                    values[resource .. "Sent"] = sent
                end
            end
            -- Engine combat counters are periodic (normally every 15 seconds).
            if Spring.GetTeamStatsHistory then
                local count = Spring.GetTeamStatsHistory(teamID)
                local history = count and count > 0 and Spring.GetTeamStatsHistory(teamID, count)
                local latest = history and history[1]
                if latest then
                    for _, key in ipairs({"damageDealt", "damageReceived", "unitsProduced", "unitsKilled", "unitsDied"}) do
                        values[key] = latest[key]
                    end
                end
            end
            if Spring.GetTeamDamageStats then
                values.damageDealt, values.damageReceived = Spring.GetTeamDamageStats(teamID)
            end
            if Spring.GetTeamUnitStats then
                values.unitsKilled, values.unitsDied = Spring.GetTeamUnitStats(teamID)
            end
            local cells = {}
            for i, key in ipairs(STAT_KEYS) do cells[i] = jsonNumber(values[key]) end
            local json = '{"frame":' .. frame .. ',"values":[' .. table.concat(cells, ",") .. ']}'
            local team = statsTeams[teamID]
            if not team then
                local _, _, _, _, _, ally = spGetTeamInfo(teamID, false)
                team = {id = teamID, ally = ally, player = teamName(teamID), samples = {}, lastFrame = -1}
                statsTeams[teamID] = team
            end
            local previous = team.lastFrame == frame and team.samples[#team.samples]
            local extra = #json - (previous and #previous or 0)
            if statsBytes + extra > 9 * 1024 * 1024 or (not previous and statsCount >= 100000) then
                statsTruncated = true
            else
                if previous then
                    team.samples[#team.samples] = json
                else
                    team.samples[#team.samples + 1] = json
                    statsCount = statsCount + 1
                end
                team.lastFrame = frame
                statsBytes = statsBytes + extra
            end
        end
    end
end

local function statisticsJSON()
    local metrics, teams, ids = {}, {}, {}
    for i, key in ipairs(STAT_KEYS) do metrics[i] = jsonString(key) end
    for id in pairs(statsTeams) do ids[#ids + 1] = id end
    table.sort(ids)
    for _, id in ipairs(ids) do
        local team = statsTeams[id]
        teams[#teams + 1] = '{"team_id":' .. id .. ',"ally_team_id":' .. jsonNumber(team.ally)
            .. ',"player":' .. jsonString(team.player) .. ',"samples":[' .. table.concat(team.samples, ",") .. ']}'
    end
    return '{\n  "format": "realbo_statistics", "schema_version": 1,'
        .. '\n  "replay_file": ' .. jsonString(replayFile) .. ', "map": ' .. jsonString(Game.mapName)
        .. ', "game_version": ' .. jsonString(Game.gameVersion or "unknown")
        .. ',\n  "game_speed": ' .. FPS .. ', "sample_period_frames": ' .. STATS_PERIOD
        .. ', "started_frame": ' .. startedFrame .. ', "export_frame": ' .. currentFrame()
        .. ', "game_over": ' .. tostring(gameOver)
        .. ', "full_replay_captured": ' .. tostring(startedFrame <= 2 and not skippedFrames and not rewindDetected)
        .. ', "truncated": ' .. tostring(statsTruncated)
        .. ',\n  "metrics": [' .. table.concat(metrics, ",") .. '],\n  "teams": [' .. table.concat(teams, ",") .. ']\n}\n'
end

local function getStatus(record, finalExport)
    if record.finishedFrame then
        if record.removedFrame then return "finished_then_removed" end
        return "finished"
    end
    if record.removedFrame then return "removed_before_completion" end
    return finalExport and "unfinished_at_end" or "under_construction"
end

local CSV_HEADER = {
    "start_time", "finish_time", "removed_time", "status", "player", "team_id",
    "building", "unit_name", "unit_def_id", "unit_id", "builder_id", "builder_name",
    "x", "y", "z", "facing", "start_seconds", "finish_seconds", "removed_seconds",
    "start_frame", "finish_frame", "removed_frame", "owner_at_end", "map", "replay_file",
    "unit_kind"
}

local function createCSV(finalExport)
    local out = { csvLine(CSV_HEADER) }
    for i = 1, #records do
        local record = records[i]
        out[#out + 1] = csvLine({
            timecode(record.startedFrame),
            timecode(record.finishedFrame),
            timecode(record.removedFrame),
            getStatus(record, finalExport),
            record.player,
            record.team,
            record.building,
            record.internalName,
            record.unitDefID,
            record.unitID,
            record.builderID,
            record.builderName,
            record.x and string.format("%.1f", record.x) or "",
            record.y and string.format("%.1f", record.y) or "",
            record.z and string.format("%.1f", record.z) or "",
            record.facing,
            secs(record.startedFrame),
            secs(record.finishedFrame),
            secs(record.removedFrame),
            record.startedFrame,
            record.finishedFrame,
            record.removedFrame,
            record.ownerAtEnd or record.player,
            Game.mapName or "",
            replayFile,
            record.unitKind,
        }, #CSV_HEADER)
    end
    return table.concat(out, "\n") .. "\n"
end

local function summaryJSON()
    local complete = 0
    local removedUnfinished = 0
    local stillBuilding = 0
    local buildings = 0
    for i = 1, #records do
        local record = records[i]
        if record.unitKind == "building" then buildings = buildings + 1 end
        if record.finishedFrame then
            complete = complete + 1
        elseif record.removedFrame then
            removedUnfinished = removedUnfinished + 1
        else
            stillBuilding = stillBuilding + 1
        end
    end
    local lines = {
        '{',
        '  "format": "realbo_summary",',
        '  "schema_version": 1,',
        '  "game_version": ' .. jsonString(Game.gameVersion or "unknown") .. ',',
        '  "replay_file": ' .. jsonString(replayFile) .. ',',
        '  "map": ' .. jsonString(Game.mapName or "") .. ',',
        '  "export_frame": ' .. tostring(currentFrame()) .. ',',
        '  "export_time": ' .. jsonString(timecode(currentFrame())) .. ',',
        '  "game_over": ' .. tostring(gameOver) .. ',',
        '  "full_replay_captured": ' .. tostring(startedFrame <= 2 and not skippedFrames and not rewindDetected) .. ',',
        '  "started_frame": ' .. tostring(startedFrame) .. ',',
        '  "skipped_frames": ' .. tostring(skippedFrames) .. ',',
        '  "rewind_detected": ' .. tostring(rewindDetected) .. ',',
        '  "counts": {',
        '    "started": ' .. tostring(#records) .. ',',
        '    "buildings": ' .. tostring(buildings) .. ',',
        '    "units": ' .. tostring(#records - buildings) .. ',',
        '    "completed": ' .. tostring(complete) .. ',',
        '    "removed_before_completion": ' .. tostring(removedUnfinished) .. ',',
        '    "unfinished": ' .. tostring(stillBuilding),
        '  }',
        '}',
    }
    return table.concat(lines, "\n") .. "\n", complete
end

local function saveText(path, content)
    if not io or not io.open then
        return false, "io.open unavailable"
    end
    -- BAR's user-widget sandbox allows writes under LuaUI/Config/.
    -- Create the dedicated export folder before any write, including the
    -- unit definitions written at initialization. Existing folders are fine.
    if Spring.CreateDir then pcall(Spring.CreateDir, EXPORT_DIR) end
    local file, err = io.open(path, "w")
    if not file then
        return false, tostring(err or "cannot open export file") .. " (check/create folder " .. EXPORT_DIR .. ")"
    end
    local success, writeErr = file:write(content)
    file:close()
    if not success then return false, tostring(writeErr or "write failed") end
    return true
end

-- Export the UnitDefID namespace used by this exact loaded BAR game/replay.
-- The detailed file includes names, internal names, types, and game metadata.
local function unitMapJSON()
    local ids = {}
    for id, def in pairs(UnitDefs) do
        if type(id) == "number" and id > 0 and id == math.floor(id) and def then
            ids[#ids + 1] = id
        end
    end
    table.sort(ids)

    local detailed = {
        "{",
        '  "game": ' .. jsonString(Game.gameName or Game.gameShortName or "BAR") .. ",",
        '  "game_version": ' .. jsonString(Game.gameVersion or "unknown") .. ",",
        '  "map": ' .. jsonString(Game.mapName or "") .. ",",
        '  "replay_file": ' .. jsonString(replayFile) .. ",",
        '  "units": {',
    }
    for n, id in ipairs(ids) do
        local def = UnitDefs[id]
        local internal = def.name or ""
        local display = def.humanName
        if not display or display == "" then display = internal end
        if not display or display == "" then display = "unitDef#" .. tostring(id) end
        local suffix = n < #ids and "," or ""
        local key = jsonString(tostring(id))
        detailed[#detailed + 1] =
            "    " .. key .. ': {"display_name": ' .. jsonString(display) ..
            ', "internal_name": ' .. jsonString(internal) ..
             ', "is_building": ' .. tostring(not not (def.isBuilding or def.isFactory)) ..
            ', "is_factory": ' .. tostring(not not def.isFactory) ..
            ', "metal_cost": ' .. jsonNumber(def.metalCost) ..
            ', "energy_cost": ' .. jsonNumber(def.energyCost) ..
            ', "category": ' .. jsonString(unitCategory(def)) .. "}" .. suffix
    end
    detailed[#detailed + 1] = "  }"
    detailed[#detailed + 1] = "}"
    return table.concat(detailed, "\n") .. "\n", #ids
end

local function exportUnitMap(force)
    if not recording then return false end
    if unitMapSaved and not force then return true end
    local detailed, count = unitMapJSON()
    local prefix = EXPORT_DIR .. "realbo_" .. fileBase
    local ok, err = saveText(prefix .. "_unit_defs.json", detailed)
    if not ok then
        echo("Unit-definition export failed: " .. tostring(err) .. " (try /realbo copyunitmap)")
        return false
    end
    unitMapSaved = true
    echo("Exported " .. tostring(count) .. " version-matched unit definitions to " .. prefix .. "_unit_defs.json")
    return true
end

local function exportCSV(force)
    if not recording then
        echo("Replay-only; nothing to export.")
        return false
    end
    local signature = tostring(#records) .. ":" .. tostring(currentFrame()) .. ":" .. tostring(gameOver)
    if not force and not dirty and signature == lastSavedSignature then return true end

    exportUnitMap(false)
    captureStats(true)
    local allCSV = createCSV(gameOver)
    local summary, completeCount = summaryJSON()
    local prefix = EXPORT_DIR .. "realbo_" .. fileBase
    local files = {
        {prefix .. "_all_units_buildings.csv", allCSV},
        {prefix .. "_summary.json", summary},
        {prefix .. "_statistics.json", statisticsJSON()},
    }
    for i = 1, #files do
        local ok, err = saveText(files[i][1], files[i][2])
        if not ok then
            echo("Export failed: " .. tostring(err) .. " (try /realbo copy)")
            return false
        end
    end
    dirty = false
    lastSavedSignature = signature
    echo("Exported " .. tostring(#records) .. " starts / " .. tostring(completeCount) .. " completions to " .. prefix .. "_*.csv")
    if startedFrame > 2 or skippedFrames or rewindDetected then
        echo("WARNING: capture may be incomplete (started late, skipped frames, or rewind). See _summary.json.")
    end
    if statsTruncated then echo("WARNING: statistics reached their size limit; later samples were not recorded.") end
    return true
end

local function resetRecording(frame)
    records = {}
    byUnitID = {}
    lastSavedSignature = ""
    dirty = true
    gameOver = false
    startedFrame = frame
    lastFrame = frame
    skippedFrames = false
    statsTeams = {}
    statsCount, statsBytes = 0, 0
    statsTruncated = false
    statsLive, statsLiveFrame = nil, nil
end

local function commandAction(_cmd, line, _words, _playerID)
    if not recording then
        echo("This widget records only during replays.")
        return true
    end
    local sub = tostring(line or ""):match("^(%S+)") or "export"
    sub = string.lower(sub)
    if sub == "export" or sub == "save" then
        exportCSV(true)
    elseif sub == "unitmap" or sub == "names" then
        exportUnitMap(true)
    elseif sub == "copyunitmap" then
        if Spring.SetClipboard then
            local detailed = unitMapJSON()
            Spring.SetClipboard(detailed)
            echo("Detailed unit-definition JSON copied to clipboard.")
        else
            echo("Clipboard API not available; use /realbo unitmap instead.")
        end
    elseif sub == "copy" then
        if Spring.SetClipboard then
            Spring.SetClipboard(createCSV(gameOver))
            echo("All buildings/units CSV copied to clipboard (paste into a text file).")
        else
            echo("Clipboard API not available; use /realbo export instead.")
        end
    elseif sub == "summary" then
        local _, done = summaryJSON()
        echo(tostring(#records) .. " buildings/units started, " .. tostring(done) .. " completed. Current replay time " .. timecode(currentFrame()))
    elseif sub == "overlay" then
        showOverlay = not showOverlay
        echo("Overlay " .. (showOverlay and "on" or "off"))
    else
        echo("Use /realbo export, /realbo unitmap, /realbo copyunitmap, /realbo copy, /realbo summary, or /realbo overlay")
    end
    return true
end

function widget:Initialize()
    recording = Spring.IsReplay and Spring.IsReplay() or false
    if not recording then return end
    gaiaTeamID = Spring.GetGaiaTeamID and Spring.GetGaiaTeamID() or nil
    replayFile = (Spring.GetReplayFilePath and Spring.GetReplayFilePath()) or "replay.sdfz"
    local basename = replayFile:match("([^/\\]+)$") or "replay"
    basename = basename:gsub("%.[sS][dD][fF][zZ]$", "")
    fileBase = basename:gsub("[^%w_-]+", "_"):sub(1, 76)
    if fileBase == "" then fileBase = "replay" end
    local frame = currentFrame()
    resetRecording(frame)
    subscribeStats()
    captureStats(true)
    unitMapSaved = false
    exportUnitMap(false) -- available immediately; no need to finish a replay for the names
    if widgetHandler.AddAction then
        widgetHandler:AddAction("realbo", commandAction, nil, "t")
    elseif widgetHandler.actionHandler and widgetHandler.actionHandler.AddAction then
        widgetHandler.actionHandler:AddAction(self, "realbo", commandAction, nil, "t")
    end
    echo("Recording actual buildings and units for replay. Speed 20x is fine. Type /realbo summary anytime.")
    if frame > 2 then
        echo("WARNING: enabled at " .. timecode(frame) .. "; earlier buildings/units cannot be recovered. Restart replay at 00:00 for a full build order.")
    end
end

function widget:GameFrame(frame)
    if not recording then return end
    if frame < lastFrame then
        rewindDetected = true
        resetRecording(frame)
        echo("Replay moved backwards: recording restarted at " .. timecode(frame) .. ". Replay from 00:00 for complete results.")
    elseif frame > lastFrame + 1 then
        skippedFrames = true
    end
    lastFrame = frame
    if not gameOver then captureStats(false) end
end

function widget:UnitCreated(unitID, unitDefID, teamID, builderID)
    if not recording or not UnitDefs[unitDefID] then return end
    if teamID == gaiaTeamID then return end
    -- If the engine recycles an ID after a unit was destroyed, retain both records.
    local previous = byUnitID[unitID]
    if previous and not previous.removedFrame then return end
    local ud = UnitDefs[unitDefID]
    local x, y, z = spGetUnitPosition(unitID)
    local builderDefID = builderID and Spring.GetUnitDefID(builderID)
    local builderDef = builderDefID and UnitDefs[builderDefID]
    local rec = {
        unitID = unitID,
        unitDefID = unitDefID,
        unitKind = isStructure(unitDefID) and "building" or "unit",
        team = teamID,
        player = teamName(teamID),
        ownerAtEnd = teamName(teamID),
        building = (ud.humanName and ud.humanName ~= "" and ud.humanName)
            or (ud.name and ud.name ~= "" and ud.name) or ("UnitDef " .. tostring(unitDefID)),
        internalName = ud.name or "",
        builderID = builderID,
        builderName = builderDef and ((builderDef.humanName and builderDef.humanName ~= "" and builderDef.humanName)
            or builderDef.name) or "",
        startedFrame = currentFrame(),
        x = x, y = y, z = z,
        facing = spGetUnitBuildFacing and spGetUnitBuildFacing(unitID) or "",
    }
    records[#records + 1] = rec
    byUnitID[unitID] = rec
    dirty = true
end

function widget:UnitFinished(unitID, unitDefID, teamID)
    if not recording then return end
    local rec = byUnitID[unitID]
    if rec and not rec.finishedFrame then
        rec.finishedFrame = currentFrame()
        dirty = true
    end
end

function widget:UnitDestroyed(unitID, unitDefID, teamID)
    if not recording then return end
    local rec = byUnitID[unitID]
    if rec and not rec.removedFrame then
        rec.removedFrame = currentFrame()
        dirty = true
    end
end

function widget:UnitGiven(unitID, unitDefID, newTeam, oldTeam)
    if not recording then return end
    local rec = byUnitID[unitID]
    if rec then
        rec.ownerAtEnd = teamName(newTeam)
        dirty = true
    end
end

function widget:GameOver(winners)
    if not recording then return end
    gameOver = true
    exportCSV(true)
end

function widget:DrawScreen()
    if not recording or not showOverlay or not gl or not gl.Text then return end
    local complete = 0
    for i = 1, #records do
        if records[i].finishedFrame then complete = complete + 1 end
    end
    local state = gameOver and "FINISHED" or "recording"
    gl.Text("RealBO " .. state .. " | started " .. tostring(#records) .. " | finished " .. tostring(complete), 22, 205, 13, "o")
    gl.Text("/realbo export | /realbo unitmap | /realbo summary", 22, 186, 11, "o")
end

function widget:Shutdown()
    if statsAPI then statsAPI.unsubscribe("RealBO") end
    if recording and (dirty or lastSavedSignature == "") then
        exportCSV(true) -- manual stop / early exit also exports partial data
    end
    if recording then
        if widgetHandler.RemoveAction then
            widgetHandler:RemoveAction("realbo", "t")
        elseif widgetHandler.actionHandler and widgetHandler.actionHandler.RemoveAction then
            widgetHandler.actionHandler:RemoveAction(self, "realbo", "t")
        end
    end
end
