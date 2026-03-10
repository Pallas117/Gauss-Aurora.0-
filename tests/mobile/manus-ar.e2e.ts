/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Detox mobile e2e contract test for Manus AR shell.
 *
 * Expected app testIDs:
 * - app-root
 * - nav-heliophysics
 * - ar-scene
 * - threat-card-top
 */

const { by, device, element, expect: detoxExpect } = require('detox');

describe('Manus AR Mission Shell', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  it('renders mission shell and core AR panel', async () => {
    await detoxExpect(element(by.id('app-root'))).toBeVisible();
    await detoxExpect(element(by.id('nav-heliophysics'))).toBeVisible();
    await detoxExpect(element(by.id('ar-scene'))).toBeVisible();
  });

  it('shows top threat action card for operator awareness', async () => {
    await detoxExpect(element(by.id('threat-card-top'))).toBeVisible();
  });
});
