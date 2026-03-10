import { Link } from "react-router-dom";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Presentation, LayoutGrid } from "lucide-react";

interface SdaHeaderProps {
    presentation: boolean;
}

export function SdaHeader({ presentation }: SdaHeaderProps) {
    return (
        <div className="flex items-center justify-between">
            <TabsList>
                <TabsTrigger value="hud">HUD</TabsTrigger>
                <TabsTrigger value="metrics">Metrics & Science</TabsTrigger>
            </TabsList>
            <div className="flex gap-2">
                {presentation ? (
                    <Button variant="outline" size="sm" asChild>
                        <Link to="/sda">
                            <LayoutGrid className="mr-1.5 h-3.5 w-3.5" />
                            Normal layout
                        </Link>
                    </Button>
                ) : (
                    <Button variant="outline" size="sm" asChild>
                        <Link to="/sda?presentation=1">
                            <Presentation className="mr-1.5 h-3.5 w-3.5" />
                            Cast / full room
                        </Link>
                    </Button>
                )}
            </div>
        </div>
    );
}
