from wiki.frappe_wiki.doctype.wiki_page_view_daily.wiki_page_view_daily import (
	ensure_web_page_view_index,
	roll_up_all_logged_days,
)


def execute():
	ensure_web_page_view_index()
	roll_up_all_logged_days()
