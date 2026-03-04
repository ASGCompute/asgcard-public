/**
 * CI Guardrail: Prevents manual direct-to-production patches.
 * Enforces that production builds only occur on the `main` branch or release tags via Git.
 */

if (process.env.VERCEL) {
    if (process.env.VERCEL_ENV === 'production') {
        const gitRef = process.env.VERCEL_GIT_COMMIT_REF;

        if (!gitRef) {
            console.error("❌ [CI GUARD] DIRECT DEPLOYMENTS TO PRODUCTION ARE FORBIDDEN.");
            console.error("❌ [CI GUARD] Please push to the 'main' branch or use git tags.");
            process.exit(1);
        }

        const { execSync } = require('child_process');
        const isSemverTag = /^v\d+\.\d+\.\d+(-\w+)?$/.test(gitRef);
        let isBranch = false;

        try {
            if (isSemverTag) {
                // If it is a branch named 'v1.0.0', git show-ref will find it in heads.
                // If it's a true tag or detached HEAD on Vercel from a tag, it won't be in heads.
                const branchCheck = execSync(`git show-ref refs/heads/${gitRef} || true`).toString('utf8');
                if (branchCheck.trim() !== '') {
                    isBranch = true;
                }
            }
        } catch (e) {
            console.error("⚠️ [CI GUARD] Failed to run git commands to verify tag vs branch.");
        }

        if (gitRef !== 'main') {
            if (!isSemverTag) {
                console.error(`❌ [CI GUARD] PRODUCTION BUILD FAILED: Branch '${gitRef}' is not allowed.`);
                console.error("❌ [CI GUARD] Must be on 'main' branch or an exact release tag like 'v1.0.0'.");
                process.exit(1);
            }
            if (isBranch) {
                console.error(`❌ [CI GUARD] PRODUCTION BUILD FAILED: Ref '${gitRef}' is a BRANCH, not a TAG.`);
                console.error("❌ [CI GUARD] Branches named like tags are strictly forbidden to prevent bypass.");
                process.exit(1);
            }
        }

        console.log(`✅ [CI GUARD] Allowed production deployment from git ref: ${gitRef}`);
    }
}

process.exit(0);
