---
title: Roles and permissions
---
Two things control what a person can do in Frappe Wiki: the Wiki roles of their user, and the access rules of each space.

## Wiki roles

Frappe Wiki adds three roles to your site. You give them to users in the Desk, on the **User** form.

| Role | What it gives |
| --- | --- |
| **Wiki User** | Opens the app at `/wiki-app`. Creates change requests in the spaces the user can read. Edits only their own change requests. Each new user gets this role. |
| **Wiki Approver** | Approves, rejects and merges change requests of other people, in spaces where the user has write access. Has write access to every open space. |
| **Wiki Manager** | Full access to every space and every change request. Sees **Overview**, **New Space**, **Settings** and the **All in review** tab. |

**System Manager** has the same access as Wiki Manager. **Administrator** can do everything.

## Space access

Each space has its own list of roles in **Space settings** > **Access**. Each row gives one role **Read** or **Write** access.

- **Read** lets a user see the space and its pages, and propose changes through a change request.
- **Write** also lets a user approve, reject and merge change requests in the space. Write includes Read.
- A space with no rows is open. Every signed-in user can read it. Users with the Wiki Approver role can write to it.
- Add the **Guest** role with **Read** to make a space public. Then everyone can read it, also people who are not signed in.
- Wiki Managers and System Managers always have full access, whatever the list says.

A person who cannot read a space does not see it in the app. In the reader, its pages show a "not found" page to them, so they cannot tell that the pages exist.

See [Who can read and write](../spaces/who-can-read-and-write.md) to change the access of a space.

## Who can do what

| Action | Who can do it |
| --- | --- |
| Create a space | Wiki Managers and System Managers |
| Change the access of a space | Users with Write access and the Wiki Approver role, and managers |
| Read a space | Users with Read or Write access |
| Create a change request | Users with Read access, when the space accepts contributions. Users with Write access always can. |
| Submit a change request | Its author |
| Withdraw a change request from review | Its author, and managers |
| Approve, request changes or reject | Users with Write access. For a change request by another person, they also need the Wiki Approver role, or must be a manager. |
| Merge an approved change request | Users with Write access. The same role rule applies as for approval. |

**Accept Contributions** is a switch in **Space settings** > **Access**. When it is off, only users with Write access can make changes in the space.

Nobody can edit a space that is synced from GitHub. Its pages change only through the repository. See [Sync a space](../github-sync/sync-a-space.md).

## Review your own changes

Frappe Wiki does not stop you from approving your own change request. If you have Write access to the space, you can approve and merge your own work. On a small team, a Wiki Manager can write a page and publish it without a second person. See [Review a change](../change-requests/review-a-change.md).
