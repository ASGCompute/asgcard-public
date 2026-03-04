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

        if (gitRef !== 'main' && !gitRef.startsWith('v')) {
            console.error(`❌ [CI GUARD] PRODUCTION BUILD FAILED: Branch '${gitRef}' is not allowed.`);
            console.error("❌ [CI GUARD] Must be on 'main' branch or a release tag 'v*'");
            process.exit(1);
        }

        console.log(`✅ [CI GUARD] Allowed production deployment from git ref: ${gitRef}`);
    }
}

process.exit(0);
