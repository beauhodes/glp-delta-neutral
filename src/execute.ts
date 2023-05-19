import { rebalance } from "./logic";
import { currentShortSizeBtc, currentShortSizeEth, maxExpectedGlpOwnedUsd, overrideGlpOwned } from "./params";

rebalance(maxExpectedGlpOwnedUsd, currentShortSizeEth, currentShortSizeBtc, overrideGlpOwned);
