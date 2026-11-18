import type { StatisticKey } from './recording-statistics-schema'

export const statisticGroups: { label: string; metrics: [StatisticKey, string][] }[] = [
  { label: 'Economy now', metrics: [
    ['metalIncome', 'Metal income /s'], ['metalExpense', 'Metal spending /s'],
    ['energyIncome', 'Energy income /s'], ['energyExpense', 'Energy spending /s'],
    ['metalCurrent', 'Metal stored'], ['metalStorage', 'Metal storage capacity'],
    ['energyCurrent', 'Energy stored'], ['energyStorage', 'Energy storage capacity'],
    ['metalReclaimIncome', 'Metal reclaim /s'], ['energyReclaimIncome', 'Energy reclaim /s'],
    ['incomeMex', 'Extractor income /s'], ['incomeConverters', 'Converter metal /s'],
    ['incomeWind', 'Wind energy /s'], ['incomeSolar', 'Solar energy /s'],
    ['incomeTidal', 'Tidal energy /s'], ['incomeGeo', 'Geothermal energy /s'],
    ['incomeFusion', 'Fusion energy /s'],
  ] },
  { label: 'Economy totals', metrics: [
    ['metalProduced', 'Metal produced'], ['metalUsed', 'Metal spent'],
    ['metalReclaimed', 'Metal reclaimed'], ['metalExcess', 'Metal excess / overflow'],
    ['metalSent', 'Metal sent'], ['metalReceived', 'Metal received'],
    ['energyProduced', 'Energy produced'], ['energyUsed', 'Energy spent'],
    ['energyReclaimed', 'Energy reclaimed'], ['energyExcess', 'Energy excess / overflow'],
    ['energySent', 'Energy sent'], ['energyReceived', 'Energy received'],
  ] },
  { label: 'Force value', metrics: [
    ['unitValue', 'Total existing force / infrastructure value'],
    ['valueArmy', 'Ground army value'], ['valueAir', 'Air force value'],
    ['valueSea', 'Navy value'], ['valueDefense', 'Static defence value'],
    ['valueStrategic', 'Strategic weapons value'], ['valueEconomy', 'Economy value'],
    ['valueFactories', 'Factory value'], ['valueBuilders', 'Constructor value'],
    ['valueUtility', 'Utility value'],
  ] },
  { label: 'Combat totals', metrics: [
    ['damageDealt', 'Damage dealt'], ['damageReceived', 'Damage received'],
    ['unitsProduced', 'Units produced'], ['unitsKilled', 'Units killed'], ['unitsDied', 'Units lost'],
    ['killedValue', 'Enemy value destroyed'], ['lostValue', 'Value lost'],
  ] },
  { label: 'Production & expansion', metrics: [
    ['buildPower', 'Build power available'], ['buildPowerActive', 'Build power active'],
    ['buildPowerIdle', 'Idle build-power minutes'], ['idleCons', 'Idle constructors'],
    ['cons', 'Constructors'], ['idleLabs', 'Idle factories'], ['labs', 'Factories'],
    ['convUse', 'Converter use'], ['convCapacity', 'Converter capacity'],
    ['metalSpots', 'Metal spots held'], ['geoSpots', 'Geothermal spots held'],
  ] },
]
