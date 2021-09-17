import fs from 'fs'
import path from "path"
import { fileURLToPath } from 'url';

import fetch from 'node-fetch'
import readline from 'readline-sync'
import {Command} from 'commander/esm.mjs';

import secrets from './secrets.js'
import config from './config.js'

const setupCLI = () => {
    const program = new Command()
    program
        .option('-t, --temperature <type>', 'set the temperature')
        .option('-m, --mode <type>', 'set to heat or cool')
        .option('-u, --up', 'Increment temp')
        .option('-d, --down', 'Decrement temp')
        .option('-l, --list-devices', 'List info about nest devices')
        .option('-s, --setup', 'Setup the CLI tool configurations and secrets')
    program.parse(process.argv);
    return program.opts();
}

let retries = 0
const options = setupCLI()
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const run = async () => {
    try {
        if (config)
        if (options.listDevices) return console.info(JSON.stringify(await getDevices(), null, 2))
        if (options.setup) return (await setup())

        const stats = await getThermoStats()
        console.info('Current Temperature Stats:', stats)
        console.info()

        options.temperature = options.temperature && Number(options.temperature)
        options.mode = options.mode ? options.mode.toUpperCase() : stats.mode

        if (options.mode !== stats.mode) {
            await setMode(options.mode)
            console.info('Mode set to', options.mode)
        }

        if (options.down) {
            options.temperature = stats.set_temp - 1
        }

        if (options.up) {
            options.temperature = stats.set_temp + 1
        }

        if (options.temperature) {
            if (options.mode && options) {
                await setMode(options.mode)
            }
            await setTemp(options.mode || stats.mode, options.temperature)
            console.info('Temperature set to', options.temperature, 'and mode', options.mode || stats.mode)
        }
    } catch (e) {
        if (e.error && e.error.message.includes('Request had invalid authentication credentials') && retries++ < config.max_retries) {
            await refreshToken()
            return await run()
        }
        throw e
    }
}

const setup = async () => {
    console.info('You will need to complete these to have appropriate setup values')
    console.info('https://developers.google.com/nest/device-access/get-started')
    console.info('https://developers.google.com/nest/device-access/authorize')
    console.info('You can edit the secrets file manually in the package folder as well')
    console.info()
    console.info()
    secrets.client_id = readline.question('What is the client_id?\n')
    console.info()
    secrets.client_secret = readline.question('What is the client_secret?\n')
    console.info()
    secrets.project_id = readline.question('What is the project_id?\n')
    console.info()
    secrets.access_token = readline.question('What is the access_token?\n')
    console.info()
    secrets.refresh_token = readline.question('What is the refresh_token?\n')
    console.info()
    secrets.authorization_code = readline.question('What is the authorization_code?\n')
    console.info()

    const devices = await getDevices()
    if (devices.length > 1) {
        console.info('Great, we will now show you a list of devices, copy the device-id of the one you are trying to use, press enter to continue.')
        readline.keyInPause()
        console.info(JSON.stringify(devices, null, 2))
        console.info()
        console.info()
        secrets.device_id = readline.question('What is the device_id?')
    } else {
        secrets.device_id = devices[0]['device-id']
    }
    saveSecrets()
}

const request = (url, options = {}) => {
    options.headers = {
        Authorization: `Bearer ${secrets.access_token}`,
        "Content-Type": "application/json"
    }

    return fetch(url, options).then(async response => {
        if (!response.ok) {
            throw await response.json()
        }
        return response.json()
    })
}

const saveSecrets = () => fs.writeFileSync(path.join(__dirname, 'secrets.js'), `export default ${JSON.stringify(secrets, null, 2)}`)

const refreshToken = async () => {
    console.debug('refreshing token')
    const response = await request(`https://www.googleapis.com/oauth2/v4/token?client_id=${secrets.client_id}&client_secret=${secrets.client_secret}&refresh_token=${secrets.refresh_token}&grant_type=refresh_token`, {
        method: "POST"
    })
    secrets.access_token = response.access_token
    saveSecrets()
}

const setMode = mode => request(`https://smartdevicemanagement.googleapis.com/v1/enterprises/${secrets.project_id}/devices/${secrets.device_id}:executeCommand`, {
    body: JSON.stringify({
        "command": "sdm.devices.commands.ThermostatMode.SetMode",
        "params": {mode}
    }),
    method: "POST"
})

const setTemp = (mode, temp) => request(`https://smartdevicemanagement.googleapis.com/v1/enterprises/${secrets.project_id}/devices/${secrets.device_id}:executeCommand`, {
    body: JSON.stringify({
        "command": `sdm.devices.commands.ThermostatTemperatureSetpoint.Set${mode[0].toUpperCase() + mode.substring(1).toLowerCase()}`,
        "params": {[mode.toLowerCase() + 'Celsius']: fToC(temp)}
    }),
    method: "POST"
})

const getStructures = () => request(`https://smartdevicemanagement.googleapis.com/v1/enterprises/${secrets.project_id}/structures`)

const getThermoStats = async () => {
    const device_info = (await deviceInfo())['traits']
    const set_temp_info = device_info['sdm.devices.traits.ThermostatTemperatureSetpoint']
    const mode = device_info['sdm.devices.traits.ThermostatMode']['mode']
    const set_temp = cToF(set_temp_info[mode.toLowerCase() + 'Celsius']) ^ 0
    const temp = round2digits(cToF(device_info["sdm.devices.traits.Temperature"]["ambientTemperatureCelsius"]))
    const humidity_percent = device_info["sdm.devices.traits.Humidity"]["ambientHumidityPercent"]

    return {
        temp,
        set_temp,
        mode,
        humidity_percent,
    }
}

const getDevices = async () => {
    const devices = (await request(`https://smartdevicemanagement.googleapis.com/v1/enterprises/${secrets.project_id}/devices`))['devices']
    devices.forEach(d => d['device-id'] = d.name.match(/.*\/(.*)/)[1])
    return devices
}
const deviceInfo = async () => (await request(`https://smartdevicemanagement.googleapis.com/v1/enterprises/${secrets.project_id}/devices/${secrets.device_id}`))

const cToF = (celsius) => celsius * 9 / 5 + 32;
const fToC = f => (f - 32) / 1.8
const round2digits = num => Math.round((num + Number.EPSILON) * 100) / 100


run().catch(console.error)

