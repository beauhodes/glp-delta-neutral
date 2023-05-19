import { ethers } from "ethers";
import { address, arbitrumRpcUrl, expectedWeightRanges, mainnetRpcUrl, tokenAddresses } from "./params";
import { feeStakedGlpAbi } from "./abis/feeStakedGlpAbi";
import { glpManagerAbi } from "./abis/glpManagerAbi";
import { glpVaultAbi } from "./abis/glpVaultAbi";
import { usdgAbi } from "./abis/usdgAbi";
import { eacAggregatorProxyAbi } from "./abis/eacAggregatorProxyAbi";

export const rebalance = async (
    maxExpectedGlpOwnedUsd: number,
    currentShortSizeEth: number,
    currentShortSizeBtc: number,
    overrideGlpOwned?: number
): Promise<{
    blockDate: Date;
    glpPriceUsd: number;
    ownedGlpValueUsd: number;
    ethShortSizeUsd: number;
    btcShortSizeUsd: number;
}> => {
    try {
        // Config
        const mainnetProvider = new ethers.providers.JsonRpcProvider(mainnetRpcUrl);
        const arbitrumProvider = new ethers.providers.JsonRpcProvider(arbitrumRpcUrl);
        const ethOracle = new ethers.Contract(
            "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
            eacAggregatorProxyAbi,
            mainnetProvider
        );
        const btcOracle = new ethers.Contract(
            "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
            eacAggregatorProxyAbi,
            mainnetProvider
        );
        const feeStakedGlp = new ethers.Contract(
            "0x1aDDD80E6039594eE970E5872D247bf0414C8903",
            feeStakedGlpAbi,
            arbitrumProvider
        );
        const glpManager = new ethers.Contract(
            "0x3963FfC9dff443c2A94f21b129D429891E32ec18",
            glpManagerAbi,
            arbitrumProvider
        );
        const glpVault = new ethers.Contract(
            "0x489ee077994B6658eAfA855C308275EAd8097C4A",
            glpVaultAbi,
            arbitrumProvider
        );
        const usdg = new ethers.Contract("0x45096e7aA921f27590f8F19e457794EB09678141", usdgAbi, arbitrumProvider);

        let promises = [];
        promises.push(arbitrumProvider.getBlock("latest"));
        promises.push(feeStakedGlp.balanceOf(address)); // GLP balance
        promises.push(glpManager.getPrice(true)); // GLP price
        promises.push(ethOracle.latestAnswer()); // ETH price
        promises.push(btcOracle.latestAnswer()); // BTC price
        promises.push(usdg.totalSupply()); // USDG supply
        for (const [_tokenName, tokenAddress] of Object.entries(tokenAddresses)) {
            promises.push(glpVault.usdgAmounts(tokenAddress));
        }
        let [
            latestBlock,
            glpOwned,
            glpPrice,
            ethPrice,
            btcPrice,
            totalUsdgSupply,
            ethUsdgSupply,
            wbtcUsdgSupply,
            usdcUsdgSupply,
            usdtUsdgSupply,
            daiUsdgSupply,
            linkUsdgSupply,
            uniUsdgSupply,
            fraxUsdgSupply
        ] = await Promise.all(promises);
        if (overrideGlpOwned) {
            // Override GLP owned for testing
            glpOwned = ethers.BigNumber.from(overrideGlpOwned);
        }

        /* 
        Calculations
            How to calculate token weights:
            1. Call totalSupply on USDG
            2. Call usdgAmounts(token) on each token on the vault
            3. Use the amounts to derive the current weight as a % for each token
        */
        const blockDate = new Date(latestBlock.timestamp * 1000);
        const ethPriceUsd = parseFloat(ethPrice.toString()) / 1e8;
        const btcPriceUsd = parseFloat(btcPrice.toString()) / 1e8;
        const totalUsdcSupplyParsed = parseFloat(ethers.utils.formatEther(totalUsdgSupply));
        const glpPriceUsd = parseFloat(ethers.utils.formatEther(glpPrice)) / 1e12;
        const glpOwnedNormalized = parseFloat(ethers.utils.formatEther(glpOwned));
        const ownedGlpValueUsd = glpPriceUsd * glpOwnedNormalized;
        let tokenWeights = {
            eth: parseFloat(ethers.utils.formatEther(ethUsdgSupply)) / totalUsdcSupplyParsed,
            wbtc: parseFloat(ethers.utils.formatEther(wbtcUsdgSupply)) / totalUsdcSupplyParsed,
            linkAndUni:
                (parseFloat(ethers.utils.formatEther(linkUsdgSupply)) +
                    parseFloat(ethers.utils.formatEther(uniUsdgSupply))) /
                totalUsdcSupplyParsed,
            stables:
                parseFloat(
                    ethers.utils.formatEther(usdcUsdgSupply) +
                        parseFloat(ethers.utils.formatEther(usdtUsdgSupply)) +
                        parseFloat(ethers.utils.formatEther(daiUsdgSupply)) +
                        parseFloat(ethers.utils.formatEther(fraxUsdgSupply))
                ) / totalUsdcSupplyParsed
        };

        // Calculate how much we need to short
        // For LINK and UNI, we multiply by 1.2x to account for volatility against ETH, and batch with ETH
        const ethWeights = tokenWeights.eth + tokenWeights.linkAndUni * 1.2;
        const btcWeights = tokenWeights.wbtc;
        const stablecoinWeights = tokenWeights.stables;
        const ethShortSizeUsd = ethWeights * ownedGlpValueUsd;
        const btcShortSizeUsd = btcWeights * ownedGlpValueUsd;
        const ethShortSizeEth = ethShortSizeUsd / ethPriceUsd;
        const btcShortSizeBtc = btcShortSizeUsd / btcPriceUsd;

        // Double-checks (date, GLP owned size, weight ranges, short sizes)
        runDoubleChecks(
            blockDate,
            maxExpectedGlpOwnedUsd,
            ownedGlpValueUsd,
            ethWeights,
            btcWeights,
            stablecoinWeights,
            ethShortSizeUsd,
            btcShortSizeUsd,
            ethPriceUsd,
            btcPriceUsd
        );

        // Check to see if we should execute trades - only if the amount of ETH/BTC shorted is +- 10% of the current short sizes
        let doRebalanceBtc = false;
        if (btcShortSizeBtc > currentShortSizeBtc * 1.1 || btcShortSizeBtc < currentShortSizeBtc * 0.9) {
            doRebalanceBtc = true;
        }
        let doRebalanceEth = false;
        if (ethShortSizeEth > currentShortSizeEth * 1.1 || ethShortSizeEth < currentShortSizeEth * 0.9) {
            doRebalanceEth = true;
        }

        // Log output
        console.log("\n==================== OUTPUT ====================");
        console.log(`- Block date: ${blockDate}`);
        console.log(`- ETH price: ${ethPriceUsd}`);
        console.log(`- BTC price: ${btcPriceUsd}`);
        console.log(`- GLP price: ${glpPriceUsd}`);
        console.log(`- $ ETH+UNI+LINK GLP weight: ${ethWeights}`);
        console.log(`- $ BTC GLP weight: ${btcWeights}`);
        console.log(`- $ Stablecoin GLP weight: ${stablecoinWeights}`);
        console.log(`- $ GLP owned: $${ownedGlpValueUsd}`);
        console.log("\n");
        console.log(`- Intended ETH short: $${ethShortSizeUsd} (${ethShortSizeEth} ETH)`);
        console.log(`- Current ETH short: $${currentShortSizeEth * ethPriceUsd} (${currentShortSizeEth} ETH)`);
        console.log(`- Intended BTC short: $${btcShortSizeUsd} (${btcShortSizeBtc} BTC)`);
        console.log(`- Current BTC short: $${currentShortSizeBtc * btcPriceUsd} (${currentShortSizeBtc} ETH)`);
        console.log("\n");
        console.log(`- Rebalance ETH short? ${doRebalanceEth ? "YES" : "No"}`);
        console.log(`- Rebalance BTC short? ${doRebalanceBtc ? "YES" : "No"}`);
        console.log("================================================\n");

        return {
            blockDate,
            glpPriceUsd,
            ownedGlpValueUsd,
            ethShortSizeUsd,
            btcShortSizeUsd
        };
    } catch (err) {
        let reasonMsg: string;
        if (err instanceof Error && err.hasOwnProperty("message") && err.message) {
            reasonMsg = err.message;
        } else {
            reasonMsg = JSON.stringify(err);
        }
        console.log(reasonMsg);
        process.exit(0);
    }
};

function runDoubleChecks(
    blockDate: Date,
    maxExpectedGlpOwnedUsd: number,
    ownedGlpValueUsd: number,
    ethWeights: number,
    btcWeights: number,
    stablecoinWeights: number,
    ethShortSizeUsd: number,
    btcShortSizeUsd: number,
    ethPriceUsd: number,
    btcPriceUsd: number
) {
    const curDate = new Date();
    if (Math.abs(curDate.getTime() - blockDate.getTime()) > 120000) {
        throw new Error("ERROR: Current date is not within 2 minutes of blockDate");
    }
    if (ownedGlpValueUsd > maxExpectedGlpOwnedUsd) {
        throw new Error(
            `ERROR: GLP owned value is $${ownedGlpValueUsd}, which is greater than max expected value of $${maxExpectedGlpOwnedUsd}`
        );
    }
    if (ethWeights < expectedWeightRanges.ethLinkUni.min || ethWeights > expectedWeightRanges.ethLinkUni.max) {
        throw new Error(
            `ERROR: ETH+LINK+UNI weight is ${ethWeights}, which is not within expected range of ${expectedWeightRanges.ethLinkUni.min} to ${expectedWeightRanges.ethLinkUni.max}`
        );
    }
    if (btcWeights < expectedWeightRanges.wbtc.min || btcWeights > expectedWeightRanges.wbtc.max) {
        throw new Error(
            `ERROR: WBTC weight is ${btcWeights}, which is not within expected range of ${expectedWeightRanges.wbtc.min} to ${expectedWeightRanges.wbtc.max}`
        );
    }
    if (stablecoinWeights < expectedWeightRanges.stables.min || stablecoinWeights > expectedWeightRanges.stables.max) {
        throw new Error(
            `ERROR: Stablecoin weight is ${stablecoinWeights}, which is not within expected range of ${expectedWeightRanges.stables.min} to ${expectedWeightRanges.stables.max}`
        );
    }
    if (ethShortSizeUsd > ownedGlpValueUsd * expectedWeightRanges.ethLinkUni.max) {
        throw new Error(
            `ERROR: ETH short size is $${ethShortSizeUsd}, which is greater than max expected value of $${
                ownedGlpValueUsd * expectedWeightRanges.ethLinkUni.max
            }`
        );
    }
    if (btcShortSizeUsd > ownedGlpValueUsd * expectedWeightRanges.wbtc.max) {
        throw new Error(
            `ERROR: BTC short size is $${btcShortSizeUsd}, which is greater than max expected value of $${
                ownedGlpValueUsd * expectedWeightRanges.wbtc.max
            }`
        );
    }
    if (!ethPriceUsd || !btcPriceUsd) {
        throw new Error(`ERROR: No ETH or BTC price found`);
    }
}
