// SPDX-License-Identifier: AGPLv3
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { ERC165CheckerUpgradeable as ERC165Checker } from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165CheckerUpgradeable.sol";

import "@openzeppelin/contracts/access/Ownable.sol";

import "../interfaces/thread/IThread.sol";

import "../common/Composable.sol";

import "../interfaces/erc20/ITimelock.sol";

// Just as the Thread can upgrade to claw back tokens, the Frabric could theoretically
// upgrade the ThreadDeployer to void its timelock. This non-upgradeable contract
// enforces it
contract Timelock is Ownable, Composable, ITimelock {
  using SafeERC20 for IERC20;
  using ERC165Checker for address;

  struct LockStruct {
    uint64 time;
    uint8 months;
  }
  mapping(address => LockStruct) private _locks;

  constructor() Composable("Timelock") Ownable() initializer {
    __Composable_init("Timelock", true);
    supportsInterface[type(Ownable).interfaceId] = true;
    supportsInterface[type(ITimelock).interfaceId] = true;
  }

  function lock(address token, uint8 months) external override onlyOwner {
    LockStruct storage _lock = _locks[token];

    // Would trivially be a DoS if token addresses were known in advance and this wasn't onlyOwner
    if (_lock.months != 0) {
      revert AlreadyLocked(token);
    }

    _lock.time = uint64(block.timestamp) + (30 days);
    _lock.months = months;
    emit Lock(token, months);
  }

  function claim(address token) external override {
    LockStruct storage _lock = _locks[token];

    // If this is a Thread token, and they've enabled upgrades, void the timelock
    // Prevents an attack vector documented in Thread where Threads can upgrade to claw back timelocked tokens
    // Enabling upgrades takes longer than voiding the timelock and actioning the tokens to some effect in response
    if (token.supportsInterface(type(Ownable).interfaceId)) {
      address owner = Ownable(token).owner();
      if ((owner.supportsInterface(type(IThreadTimelock).interfaceId)) && (IThreadTimelock(owner).upgradesEnabled() != 0)) {
        _lock.months = 0;
      }
    }

    // Enables recovering accidentally sent tokens
    if (_lock.months == 0) {
      _lock.months = 1;
    } else {
      if (_lock.time > block.timestamp) {
        revert Locked(token, block.timestamp, _lock.time);
      }
      _lock.time += 30 days;
    }

    uint256 amount = IERC20(token).balanceOf(address(this)) / _lock.months;
    _lock.months -= 1;
    emit Claim(token, amount);
    IERC20(token).safeTransfer(owner(), amount);
  }

  function nextLockTime(address token) external view override returns (uint64) {
    return _locks[token].time;
  }
  function remainingMonths(address token) external view override returns (uint8) {
    return _locks[token].months;
  }
}
