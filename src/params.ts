import "dotenv/config";

export const address = process.env.ADDRESS;
export const mainnetRpcUrl = process.env.MAINNET_RPC_URL || "";
export const arbitrumRpcUrl = process.env.ARBITRUM_RPC_URL || "";

export const maxExpectedGlpOwnedUsd: number = process.env.MAX_EXPECTED_GLP_OWNED_USD
    ? parseFloat(process.env.MAX_EXPECTED_GLP_OWNED_USD)
    : 0;
export const currentShortSizeEth: number = process.env.CURRENT_SHORT_SIZE_ETH
    ? parseFloat(process.env.CURRENT_SHORT_SIZE_ETH)
    : 0;
export const currentShortSizeBtc: number = process.env.CURRENT_SHORT_SIZE_BTC
    ? parseFloat(process.env.CURRENT_SHORT_SIZE_BTC)
    : 0;
export const overrideGlpOwned: number | undefined = process.env.OVERRIDE_GLP_OWNED
    ? parseFloat(process.env.OVERRIDE_GLP_OWNED)
    : undefined;

export const tokenAddresses = {
    eth: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    wbtc: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
    usdc: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
    usdt: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    dai: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    link: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4",
    uni: "0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0",
    frax: "0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F"
};

export const expectedWeightRanges = {
    ethLinkUni: {
        min: 0.19,
        max: 0.45
    },
    wbtc: {
        min: 0.15,
        max: 0.35
    },
    stables: {
        min: 0.35,
        max: 0.65
    }
};
