package util

import "strings"

type Action struct {
	Type  string
	Value string
	Extra string
}

func ParseScript(script string) []Action {
	var actions []Action
	parts := strings.Split(script, ";")
	for _, part := range parts {
		if part == "" {
			continue
		}
		split := strings.SplitN(part, ":", 2)
		action := Action{Type: split[0]}
		if len(split) > 1 {
			if action.Type == "type" {
				extraSplit := strings.SplitN(split[1], ",", 2)
				action.Value = extraSplit[0]
				if len(extraSplit) > 1 {
					action.Extra = extraSplit[1]
				}
			} else {
				action.Value = split[1]
			}
		}
		actions = append(actions, action)
	}
	return actions
} 