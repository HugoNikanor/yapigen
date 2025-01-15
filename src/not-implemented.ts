export { NotImplemented }

class NotImplemented extends Error {
  constructor(feature: string) {
    super(`Feature not implemented: ${feature}`)
    this.name = this.constructor.name
  }
}
