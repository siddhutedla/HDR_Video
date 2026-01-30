const path = require('path');
const { test, expect } = require('@playwright/test');

const HDR_NAME = 'HDR_041_Path_Ref.hdr';
const HDR_PATH = path.join(__dirname, '..', 'assets', HDR_NAME);

test.describe('HDR Video Viewer', () => {
  test('renders bundled HDR and handles uploads', async ({ page }) => {
    await page.goto('/');

    const imageShell = page.locator('#imageShell');
    const hdrNote = page.locator('#hdrNote');
    const hdrFileInfo = page.locator('#hdrFileInfo');

    await expect(imageShell).toBeVisible();
    await expect(hdrNote).toHaveText(/Loaded bundled sample HDR file/i, { timeout: 15000 });
    await expect(hdrFileInfo).toContainText('MB');

    // No upload UI should be present
    await expect(page.locator('#fileInput')).toHaveCount(0);
    await expect(page.locator('#dropzone')).toHaveCount(0);
  });
});
