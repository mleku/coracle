import {collection} from "src/engine/core/utils"
import type {Group, GroupKey, GroupRequest} from "./model"

export const groups = collection<Group>("address")
export const groupAdminKeys = collection<GroupKey>("pubkey")
export const groupSharedKeys = collection<GroupKey>("pubkey")
export const groupRequests = collection<GroupRequest>("id")
