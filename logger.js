const logger = {
    log: (...args) => console.log(new Date(), ...args),
    error: (...args) => console.error(new Date(), ...args)
}

module.exports = {
    logger
}